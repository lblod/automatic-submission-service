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
import rateLimit from 'express-rate-limit';

app.use(errorHandler);
// support both jsonld and json content-type
app.use(bodyParser.json({type: 'application/ld+json'}));
app.use(bodyParser.json());

app.post('/melding', async function (req, res) {
  try {
    ensureValidContentType(req.get('content-type'));
    ensureValidDataType(req.body);
    // enrich the body with minimum required json LD properties
    const enrichedBody = await enrichBodyForRegister(req.body);
    // extracted the minimal required triples
    const store = await jsonLdToStore(enrichedBody);
    //const triples = await jsonld.default.toRDF(enrichedBody, {});

    const extracted = extractInfoFromTriplesForRegister(store);

    // check if the minimal required payload is available
    ensureMinimalRegisterPayload(extracted);

    // check if the extracted properties are valid
    ensureValidRegisterProperties(extracted);

    const { submittedResource, authenticationConfiguration } = extracted;

    // authenticate vendor
    const organisationID = await ensureAuthorisation(store);

    // check if the resource has already been submitted
    await ensureNotSubmitted(submittedResource);

    // process the new auto-submission
    const submissionGraph = `http://mu.semte.ch/graphs/organizations/${organisationID}/LoketLB-toezichtGebruiker`;
    const { submissionUri, jobUri } = await storeSubmission(
      store,
      submissionGraph,
      submissionGraph,
      authenticationConfiguration
    );
    res.status(201).send({ submission: submissionUri, job: jobUri }).end();
  } catch (e) {
    console.error(e.message);
    if (!e.alreadyStoredError) {
      const detail = JSON.stringify(
        {
          err: e.message,
          req: cleanseRequestBody(req.body),
        },
        undefined,
        2
      );
      sendErrorAlert({
        message:
          'Something unexpected went wrong while processing an auto-submission request.',
        detail,
        reference: e.reference,
      });
    }
    res
      .status(500)
      .send(
        `An error happened while processing the auto-submission request. If this keeps occurring for no good reason, please contact us at digitaalABB@vlaanderen.be. Please consult the technical error below.\n${e.message}`
      )
      .end();
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

const statusLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  message:
    'There have been too many requests about this submission. The amount of status requests is limited to 5 per minute. Try again later.',
  keyGenerator: async (req) => {
    await ensureValidContentType(req.get('content-type'));
    const enrichedBody = await enrichBodyForStatus(req.body);
    const store = await jsonLdToStore(enrichedBody);
    const submissionUris = store.getObjects(
      undefined,
      namedNode('http://purl.org/dc/terms/subject')
    );
    const submissionUri = submissionUris[0]?.value;
    return submissionUri || '';
  },
});

app.post('/status', statusLimiter, async function (req, res) {
  try {
    await ensureValidContentType(req.get('content-type'));
    const enrichedBody = await enrichBodyForStatus(req.body);
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

function ensureValidDataType(body) {
  if (body instanceof Array)
    throw new Error(
      'Invalid JSON payload, expected an object but found array.'
    );
}

function ensureMinimalRegisterPayload(object) {
  for (const prop in object)
    if (!object[prop] && prop != 'authenticationConfiguration')
      throw new Error(
        `Invalid JSON-LD payload: property "${prop}" is missing or invalid.`
      );
}

function ensureValidRegisterProperties(object) {
  const { isValid, errors } = validateExtractedInfo(object);
  if (!isValid)
    throw new Error(
      `Some given properties are invalid:\n${errors
        .map((e) => e.message)
        .join('\n')}
      `
    );
}

async function ensureNotSubmitted(submittedResource) {
  if (await isSubmitted(submittedResource))
    throw new Error(
      `The given submittedResource <${submittedResource}> has already been submitted.`
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
  if (!organisationID) {
    const error = new Error(
      'Authentication failed, vendor does not have access to the organization or does not exist. If this should not be the case, please contact us at digitaalABB@vlaanderen.be for login credentials.'
    );
    error.reference = authentication.vendor;
    throw error;
  }
  return organisationID;
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
