import {app, errorHandler} from 'mu';
import { verifyKeyAndOrganisation, storeSubmission, isSubmitted, sendErrorAlert, cleanseRequestBody } from './support';
import bodyParser from 'body-parser';
import * as jsonld from 'jsonld';
import {enrichBody, extractInfoFromTriples, validateExtractedInfo} from "./jsonld-input";
import { remoteDataObjectStatusChange } from './downloadTaskManagement.js';
import * as env from './env.js';
import { getTaskInfoFromRemoteDataObject, downloadTaskUpdate } from './downloadTaskManagement.js';
import { Lock } from 'async-await-mutex-lock';

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
      await enrichBody(body);
      // extracted the minimal required triples
      const triples = await jsonld.toRDF(body, {});

      const extracted = extractInfoFromTriples(triples);

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
      const uri = await storeSubmission(triples, submissionGraph, submissionGraph, authenticationConfiguration);
      res.status(201).send({uri}).end();
    }
  } catch (e) {
    console.error(e.message);
    const detail = JSON.stringify( {
      err: e.message,
      req: cleanseRequestBody(req.body)
    }, undefined, 2);
    sendErrorAlert({
      message: 'Something unexpected went wrong while processing an auto-submission request.',
      detail,
    });
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
      .filter((insert) => /http:\/\/data.lblod.info\/id\/remote-data-objects\//.test(insert.subject.value))
      .filter((insert) => insert.predicate.value === env.ADMS_STATUS_PREDICATE)
      .filter((insert) => insert.object.value === env.DOWNLOAD_STATUSES.ongoing ||
                          insert.object.value === env.DOWNLOAD_STATUSES.success ||
                          insert.object.value === env.DOWNLOAD_STATUSES.failure);
    for (const remoteDataObjectTriple of actualStatusChange) {
      const { downloadTaskUri, jobUri, oldStatus, submissionGraph } = await getTaskInfoFromRemoteDataObject(remoteDataObjectTriple.subject.value);
      //Update the status also passing the old status to not make any illegal updates
      await downloadTaskUpdate(submissionGraph, downloadTaskUri, jobUri, oldStatus, remoteDataObjectTriple.object.value);
    }
  }
  catch (e) {
    console.error(e.message);
    sendErrorAlert({
      message: 'Could not process a download status update' ,
      detail: JSON.stringify({ error: e.message, }),
    });
    res.status(500).json({
      errors: [{
        title: "An error occured while updating the staus of a downloaded file",
        error: JSON.stringify(e),
      }]
    });
  }
  finally {
    lock.release();
  }
});

