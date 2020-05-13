import _ from 'lodash';

import { uuid } from 'mu';
import {getContext} from "./jsonld-context";

const CONCEPT_STATUS = 'http://lblod.data.gift/concepts/79a52da4-f491-4e2f-9374-89a13cde8ecd';
const SUBMITTABLE_STATUS = 'http://lblod.data.gift/concepts/f6330856-e261-430f-b949-8e510d20d0ff';

/*
 * This method ensures some basic things on the root node of the request body
 * e.g the root node should have a URI (@id), context (@context) and a type.
 * it also adds a uuid for internal processing, since it's used for constructing the URI if necessary
 */
export async function enrichBody(originalBody) {
  if(! originalBody["@type"]) {
    originalBody["@type"] = "meb:Submission";
  }
  if (! originalBody["@context"]) {
    originalBody["@context"] = await getContext();
  }
  const id = uuid();
  originalBody["http://mu.semte.ch/vocabularies/core/uuid"]=id;
  if ( !originalBody["@id"] ) {
    originalBody["@id"] = `http://data.lblod.info/submissions/${id}`;
  }
  if ( !originalBody["status"] ) { // concept status by default
    originalBody["status"] = CONCEPT_STATUS;
  }
  return originalBody;
}

export function extractInfoFromTriples(triples) {
  const key = _.get(triples.find(
      (triple) => triple.predicate.value === 'http://mu.semte.ch/vocabularies/account/key'), "object.value");

  const vendor = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://purl.org/pav/providedBy'), "object.value");

  const organisation = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://purl.org/pav/createdBy'), "object.value");

  const submittedResource = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://www.w3.org/ns/prov#atLocation'), "object.value");

  const status = _.get(triples.find(
    (triple) => triple.predicate.value === 'http://www.w3.org/ns/adms#status'), "object.value");

  return {key, vendor, organisation, submittedResource, status};
}

export function validateExtractedInfo(extracted) {
  const {status} = extracted;
  const errors = [];
  if (status !== CONCEPT_STATUS && status !== SUBMITTABLE_STATUS)
    errors.push({ title: "Invalid status" });

  return { isValid: errors.length === 0, errors };
}