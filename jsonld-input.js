import _ from 'lodash';
import { uuid } from 'mu';
import * as env from './env.js';
import { SubmissionRegistrationContext } from './SubmissionRegistrationContext.js';

/*
 * This method ensures some basic things on the root node of the request body
 * e.g the root node should have a URI (@id), context (@context) and a type.
 * it also adds a uuid for internal processing, since it's used for constructing the URI if necessary
 */
export async function enrichBody(originalBody) {
  if (!originalBody["@type"]) {
    originalBody["@type"] = "meb:Submission";
  }
  if (!originalBody['@context']) {
    originalBody['@context'] = SubmissionRegistrationContext;
  }
  const id = uuid();
  originalBody["http://mu.semte.ch/vocabularies/core/uuid"] = id;
  if (!originalBody["@id"]) {
    originalBody["@id"] = `http://data.lblod.info/submissions/${id}`;
  }
  if (!originalBody["status"]) { // concept status by default
    originalBody["status"] = env.CONCEPT_STATUS;
  }
  if (originalBody["authentication"]) {
    originalBody["authentication"]["@id"] = `http://data.lblod.info/authentications/${uuid()}`;
    originalBody["authentication"]["configuration"]["@id"] = `http://data.lblod.info/configurations/${uuid()}`;
    originalBody["authentication"]["credentials"]["@id"] = `http://data.lblod.info/credentials/${uuid()}`;
  }
  return originalBody;
}

export async function enrichBodyForStatus(body) {
  if (!body['@context']) {
    body['@context'] = SubmissionRegistrationContext;
  }
  const requestId = uuid();
  if (!body['@id'])
    body['@id'] = `http://data.lblod.info/submission-status-request/${requestId}`;
  if (!body['@type'])
    body['@type'] = 'http://data.lblod.info/submission-status-request/Request';
  if (body.authentication) {
    body.authentication['@id'] = `http://data.lblod.info/authentications/${uuid()}`;
    body.authentication.configuration['@id'] = `http://data.lblod.info/configurations/${uuid()}`;
    body.authentication.credentials['@id'] = `http://data.lblod.info/credentials/${uuid()}`;
  }
  return body;
}

export function extractInfoFromTriples(triples) {
  const key = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://mu.semte.ch/vocabularies/account/key'), "object.value");

  const vendor = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://purl.org/pav/providedBy'), "object.value");

  const organisation = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://purl.org/pav/createdBy'), "object.value");

  const submittedResource = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://purl.org/dc/terms/subject'), "object.value");

  const status = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://www.w3.org/ns/adms#status'), "object.value");

  const authenticationConfiguration = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://lblod.data.gift/vocabularies/security/targetAuthenticationConfiguration'), "object.value");

  return {
    key,
    vendor,
    organisation,
    submittedResource,
    status,
    authenticationConfiguration
  };
}

export function validateExtractedInfo(extracted) {
  const {status} = extracted;
  const errors = [];
  if (status !== env.CONCEPT_STATUS && status !== env.SUBMITTABLE_STATUS)
    errors.push({title: `property status is not valid.`});

  return {isValid: errors.length === 0, errors};
}
