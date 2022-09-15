import { uuid } from 'mu';
import * as env from './env.js';
import { SubmissionRegistrationContext } from './SubmissionRegistrationContext.js';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

/*
 * This method ensures some basic things on the root node of the request body
 * e.g the root node should have a URI (@id), context (@context) and a type.
 * it also adds a uuid for internal processing, since it's used for constructing the URI if necessary
 */
export async function enrichBodyForRegister(originalBody) {
  if (!originalBody['@type']) {
    originalBody['@type'] = 'meb:Submission';
  }
  if (!originalBody['@context']) {
    originalBody['@context'] = SubmissionRegistrationContext;
  }
  const id = uuid();
  originalBody['http://mu.semte.ch/vocabularies/core/uuid'] = id;
  if (!originalBody['@id']) {
    originalBody['@id'] = `http://data.lblod.info/submissions/${id}`;
  }
  if (!originalBody.status) {
    // concept status by default
    originalBody.status = env.CONCEPT_STATUS;
  }
  if (originalBody.authentication) {
    originalBody.authentication[
      '@id'
    ] = `http://data.lblod.info/authentications/${uuid()}`;
    originalBody.authentication.configuration[
      '@id'
    ] = `http://data.lblod.info/configurations/${uuid()}`;
    originalBody.authentication.credentials[
      '@id'
    ] = `http://data.lblod.info/credentials/${uuid()}`;
  }
  return originalBody;
}

export async function enrichBodyForStatus(body) {
  if (!body['@context']) {
    body['@context'] = SubmissionRegistrationContext;
  }
  const requestId = uuid();
  if (!body['@id'])
    body[
      '@id'
    ] = `http://data.lblod.info/submission-status-request/${requestId}`;
  if (!body['@type'])
    body['@type'] = 'http://data.lblod.info/submission-status-request/Request';
  if (body.authentication) {
    body.authentication[
      '@id'
    ] = `http://data.lblod.info/authentications/${uuid()}`;
    body.authentication.configuration[
      '@id'
    ] = `http://data.lblod.info/configurations/${uuid()}`;
    body.authentication.credentials[
      '@id'
    ] = `http://data.lblod.info/credentials/${uuid()}`;
  }
  return body;
}

export function extractInfoFromTriplesForRegister(store) {
  const locationHrefs = store.getObjects(
    undefined,
    namedNode('http://www.w3.org/ns/prov#atLocation')
  );
  const submittedResources = store.getObjects(
    undefined,
    namedNode('http://purl.org/dc/terms/subject')
  );
  const statuses = store.getObjects(
    undefined,
    namedNode('http://www.w3.org/ns/adms#status')
  );
  const authenticationConfigurations = store.getObjects(
    undefined,
    namedNode(
      'http://lblod.data.gift/vocabularies/security/targetAuthenticationConfiguration'
    )
  );
  return {
    submittedResource: submittedResources[0]?.value,
    status: statuses[0]?.value,
    authenticationConfiguration: authenticationConfigurations[0]?.value,
    href: locationHrefs[0]?.value,
  };
}

export function extractAuthentication(store) {
  const keys = store.getObjects(
    undefined,
    namedNode('http://mu.semte.ch/vocabularies/account/key')
  );
  const vendors = store.getObjects(
    undefined,
    namedNode('http://purl.org/pav/providedBy')
  );
  const organisations = store.getObjects(
    undefined,
    namedNode('http://purl.org/pav/createdBy')
  );
  return {
    key: keys[0]?.value,
    vendor: vendors[0]?.value,
    organisation: organisations[0]?.value,
  };
}

export function validateExtractedInfo(extracted) {
  const { status } = extracted;
  const errors = [];
  if (status !== env.CONCEPT_STATUS && status !== env.SUBMITTABLE_STATUS)
    errors.push({ message: 'Property status is not valid.' });

  return { isValid: errors.length === 0, errors };
}
