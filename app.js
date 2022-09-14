import {app, errorHandler} from 'mu';
import { verifyKeyAndOrganisation, storeSubmission, isSubmitted, sendErrorAlert, cleanseRequestBody } from './support.js';
import bodyParser from 'body-parser';
import * as jsonld from 'jsonld';
import {
  enrichBodyForRegister,
  enrichBodyForStatus,
  extractInfoFromTriplesForRegister,
  extractAuthentication,
  validateExtractedInfo,
} from './jsonld-input.js';
import * as env from './env.js';
import { getTaskInfoFromRemoteDataObject, downloadTaskUpdate } from './downloadTaskManagement.js';
import { getSubmissionStatusRdfJS } from './jobAndTaskManagement.js';
import { Lock } from 'async-await-mutex-lock';
const N3 = require('n3');
const { DataFactory } = N3;
const { namedNode } = DataFactory;

app.use(errorHandler);
// support both jsonld and json content-type
app.use(bodyParser.json({type: 'application/ld+json'}));
app.use(bodyParser.json());

app.post('/melding', async function (req, res, next) {
  const validContentType = /application\/(ld\+)?json/.test(req.get('content-type'));
  if (!validContentType) {
    res.status(400).send({errors: [{title: "invalid content-type only application/json or application/ld+json are accepted"}]}).end();
  }
  try {
    if (req.body instanceof Array) {
      res.status(400).send({errors: [{title: "invalid json payload, expected an object but found array"}]}).end();
    } else {
      const body = req.body;
      console.log("Incoming request on /melding");
      //console.debug(body);

      // enrich the body with minimum required json LD properties
      await enrichBodyForRegister(body);
      // extracted the minimal required triples
      const triples = await jsonld.default.toRDF(body, {});

      const extracted = extractInfoFromTriplesForRegister(triples);

      // check if the minimal required payload is available
      for (let prop in extracted) {
        if (!extracted[prop] && prop != 'authenticationConfiguration') { //TODO: if required vs optional fields grow, this will need to be better
          console.log(`WARNING: received an invalid JSON-LD payload! Could not extract ${prop}`);
          console.debug(body);
          res.status(400).send({
            errors: [{
              title: `Invalid JSON-LD payload: property ${prop.toLocaleUpperCase()} is missing or invalid.`,
              extractedTriples: triples
            }]
          }).end();
          return;
        }
      }

      // check if the extracted properties are valid
      const {isValid, errors} = validateExtractedInfo(extracted);
      if (!isValid) {
        res.status(400).send({errors}).end();
        return;
      }

      const { key, vendor, organisation, submittedResource, authenticationConfiguration } = extracted;

      // authenticate vendor
      const organisationID = await verifyKeyAndOrganisation(vendor, key, organisation);
      if (!organisationID) {
        const detail = JSON.stringify(cleanseRequestBody(req.body), undefined, 2);
        sendErrorAlert({
          message: `Authentication failed, vendor does not have access to the organization or doesn't exist.` ,
          detail,
          reference: vendor
        });
        res.status(401).send({
          errors: [{
            title: "Authentication failed, you do not have access to this resource. " +
              "If this should not be the case, please contact us at digitaalABB@vlaanderen.be for login credentials."
          }]
        }).end();
        return;
      }

      // check if the resource has already been submitted
      if (await isSubmitted(submittedResource)) {
        res.status(409).send({
          errors: [{
            title: `The given submittedResource <${submittedResource}> has already been submitted.`
          }]
        }).end();
        return;
      }

      // process the new auto-submission
      const submissionGraph = `http://mu.semte.ch/graphs/organizations/${organisationID}/LoketLB-toezichtGebruiker`;
      const { submissionUri, jobUri } = await storeSubmission(triples, submissionGraph, submissionGraph, authenticationConfiguration);
      res.status(201).send({submission: submissionUri, job: jobUri}).end();
    }
  } catch (e) {
    console.error(e.message);
    if (!e.alreadyStoredError) {
      const detail = JSON.stringify( {
        err: e.message,
        req: cleanseRequestBody(req.body)
      }, undefined, 2);
      sendErrorAlert({
        message: 'Something unexpected went wrong while processing an auto-submission request.',
        detail,
      });
    }
    res.status(400).send({
      errors: [{
        title: 'Something unexpected happened while processing the auto-submission request. ' +
          'If this keeps occurring, please contact us at digitaalABB@vlaanderen.be.'
      }]
    }).end();
  }
});

const lock = new Lock();

app.post('/download-status-update', async function (req, res) {
  //The locking is needed because the delta-notifier sends the same request twice to this API because a status update is both deleted and inserted. We don't want this; we can't change that for now, so we block such that no 2 requests are handled at the same time and then limit the way status changes can be performed.
  await lock.acquire();
  try {
    //Because the delta-notifier is lazy/incompetent we need a lot more filtering before we actually know that a resource's status has been set to ongoing
    const actualStatusChange = req.body
      .map((changeset) => changeset.inserts)
      .filter((inserts) => inserts.length > 0)
      .flat()
      .filter((insert) => insert.predicate.value === env.ADMS_STATUS_PREDICATE)
      .filter((insert) => insert.object.value === env.DOWNLOAD_STATUSES.ongoing ||
                          insert.object.value === env.DOWNLOAD_STATUSES.success ||
                          insert.object.value === env.DOWNLOAD_STATUSES.failure);
    for (const remoteDataObjectTriple of actualStatusChange) {
      const { downloadTaskUri, jobUri, oldStatus, submissionGraph, fileUri, errorMsg } = await getTaskInfoFromRemoteDataObject(remoteDataObjectTriple.subject.value);
      //Update the status also passing the old status to not make any illegal updates
      await downloadTaskUpdate(submissionGraph, downloadTaskUri, jobUri, oldStatus, remoteDataObjectTriple.object.value, remoteDataObjectTriple.subject.value, fileUri, errorMsg);
    }
    res.status(200).send().end();
  }
  catch (e) {
    console.error(e.message);
    if (!e.alreadyStoredError)
      sendErrorAlert({
        message: 'Could not process a download status update' ,
        detail: JSON.stringify({ error: e.message, }),
      });
    res.status(500).json({
      errors: [{
        title: "An error occured while updating the status of a downloaded file",
        error: JSON.stringify(e),
      }]
    });
  }
  finally {
    lock.release();
  }
});

//Incoming request:
//  HTTP POST or HTTP GET /status
//  {
//     submission: <uri>,
//
//  }

app.post('/status', async function (req, res) {
  try {
    await ensureValidContentType(req.get('content-type'));
    const body = req.body;
    const enrichedBody = await enrichBodyForStatus(body);

    const store = await jsonLdToStore(enrichedBody);

    await ensureAuthorisation(store);

    const submissionUris = store.getObjects(
      undefined,
      namedNode('http://purl.org/dc/terms/subject')
    );
    const submissionUri = submissionUris[0]?.value;
    if (!submissionUri)
      throw new Error('There was no submission URI in the request');

    const { statusRdfJSTriples, JobStatusContext, JobStatusFrame } =
      await getSubmissionStatusRdfJS(submissionUri);
    const jsonLdObject = await storeToJsonLd(
      statusRdfJSTriples,
      JobStatusContext,
      JobStatusFrame
    );
    res.status(200).send(jsonLdObject);
  } catch (error) {
    const message =
      'Something went wrong while fetching the status of the submitted resource and its associated Job';
    console.error(message, error.message);
    console.error(error);
    await sendErrorAlert({ message, detail: error.message });
    res.status(500).send(`${message}\n${error.message}`);
  }
});

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

function ensureValidContentType(contentType) {
  if (!/application\/(ld\+)?json/.test(contentType))
    throw new Error(
      'Content-Type not valid, only application/json or application/ld+json are accepted'
    );
}

async function ensureAuthorisation(store) {
  const authentication = extractAuthentication(store);
  if (
    !(
      authentication.vendor &&
      authentication.key &&
      authentication.organisation
    )
  )
    throw new Error(
      'The authentication (or part of it) for this request is missing. Make sure to supply publisher (with vendor URI and key) and organization information to the request.'
    );
  const organisationID = await verifyKeyAndOrganisation(
    authentication.vendor,
    authentication.key,
    authentication.organisation
  );
  if (!organisationID)
    throw new Error(
      'Authentication failed, vendor does not have access to the organization or does not exist.'
    );
}

async function jsonLdToStore(jsonLdObect) {
  const requestNQuads = await jsonld.default.toRDF(jsonLdObect, {
    format: 'application/n-quads',
  });
  const parser = new N3.Parser({ format: 'application/n-quads' });
  const requestRdfjsTriples = parser.parse(requestNQuads);
  const store = new N3.Store();
  store.addQuads(requestRdfjsTriples);
  return store;
}

async function storeToJsonLd(store, context, frame) {
  const writer = new N3.Writer({ format: 'application/n-quads' });
  store.forEach((quad) => writer.addQuad(quad));
  const ttl = await new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
  const jsonld1 = await jsonld.default.fromRDF(ttl, {
    format: 'application/n-quads',
  });
  const framed = await jsonld.default.frame(jsonld1, frame);
  const compacted = await jsonld.default.compact(framed, context);
  return compacted;
}
