import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {uuid, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime} from 'mu';
import {Writer} from 'n3';

const PREFIXES = `PREFIX meb:   <http://rdf.myexperiment.org/ontologies/base/>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
  PREFIX pav:   <http://purl.org/pav/>
  PREFIX dct:   <http://purl.org/dc/terms/>
  PREFIX melding:   <http://lblod.data.gift/vocabularies/automatische-melding/>
  PREFIX lblodBesluit:  <http://lblod.data.gift/vocabularies/besluit/>
  PREFIX adms:  <http://www.w3.org/ns/adms#>
  PREFIX muAccount:   <http://mu.semte.ch/vocabularies/account/>
  PREFIX eli:   <http://data.europa.eu/eli/ontology#>
  PREFIX org:   <http://www.w3.org/ns/org#>
  PREFIX elod:  <http://linkedeconomy.org/ontology#>
  PREFIX nie:   <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
  PREFIX prov:  <http://www.w3.org/ns/prov#>
  PREFIX mu:   <http://mu.semte.ch/vocabularies/core/>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  PREFIX nfo:   <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX http: <http://www.w3.org/2011/http#>
  PREFIX rpioHttp: <http://redpencil.data.gift/vocabularies/http/>
`;

async function isSubmitted(resource) {
  const result = await query(`
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

      SELECT (COUNT(*) as ?count)
      WHERE {
          ${sparqlEscapeUri(resource)} ?p ?o .
      }
    `);

  return parseInt(result.results.bindings[0].count.value) > 0;
}

function extractSubmissionUrl(triples) {
  return triples.find((triple) =>
    triple.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
    triple.object.value === "http://rdf.myexperiment.org/ontologies/base/Submission"
  ).subject.value;
}

function findSubmittedResource(triples) {
  return triples.find((triple) => triple.predicate.value === "http://purl.org/dc/terms/subject").object.value;
}

function extractLocationUrl(triples) {
  return triples.find((triple) => triple.predicate.value === "http://www.w3.org/ns/prov#atLocation").object.value;
}

function extractMeldingUri(triples) {
  return triples.find((triple) => triple.object.value === "http://rdf.myexperiment.org/ontologies/base/Submission").subject.value;
}

async function triplesToTurtle(triples) {
  const vendor = triples.find((t) => t.predicate.value === 'http://purl.org/pav/providedBy').object.value;
  const triplesToSave = triples.filter((t) => {
    return t.subject.value !== vendor;
  });
  const promise = new Promise((resolve, reject) => {
    const writer = new Writer({format: 'application/n-quads'});
    writer.addQuads(triplesToSave);
    writer.end((error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
  return promise;
}

async function storeSubmission(triples, submissionGraph, fileGraph) {

  const submittedResource = findSubmittedResource(triples);
  const turtle = await triplesToTurtle(triples);
  await update(`
${PREFIXES}
INSERT DATA {
  GRAPH ${sparqlEscapeUri(submissionGraph)} {
     ${turtle}
     ${sparqlEscapeUri(submittedResource)} a foaf:Document, ext:SubmissionDocument .
  }
}`);
  await update(`
${PREFIXES}
INSERT {
  GRAPH ${sparqlEscapeUri(submissionGraph)} {
     ${sparqlEscapeUri(submittedResource)} mu:uuid ${sparqlEscapeString(uuid())} .
  }
} WHERE {
  GRAPH ${sparqlEscapeUri(submissionGraph)} {
     ${sparqlEscapeUri(submittedResource)} a foaf:Document .
     FILTER NOT EXISTS { ${sparqlEscapeUri(submittedResource)} mu:uuid ?uuid . }
  }
}`);
  const taskId = uuid();
  const taskUri = `http://data.lblod.info/id/automatic-submission-task/${taskId}`;
  const timestamp = new Date();
  const meldingUri = extractMeldingUri(triples);
  await update(`
${PREFIXES}
INSERT DATA {
  GRAPH ${sparqlEscapeUri(submissionGraph)} {
     ${sparqlEscapeUri(taskUri)} a melding:AutomaticSubmissionTask;
                                    mu:uuid ${sparqlEscapeString(taskId)};
                                    dct:creator <http://lblod.data.gift/services/automatic-submission-service>;
                                    adms:status <http://lblod.data.gift/automatische-melding-statuses/not-started>;
                                    dct:created ${sparqlEscapeDateTime(timestamp)};
                                    dct:modified ${sparqlEscapeDateTime(timestamp)};
                                    prov:generated ${sparqlEscapeUri(meldingUri)}.
  }
}
`);
  const remoteDataId = uuid();
  const remoteDataUri = `http://data.lblod.info/id/remote-data-objects/${remoteDataId}`;
  const locationUrl = extractLocationUrl(triples);
  await update(`
${PREFIXES}
INSERT DATA {
  GRAPH ${sparqlEscapeUri(fileGraph)} {
      ${sparqlEscapeUri(remoteDataUri)} a nfo:RemoteDataObject, nfo:FileDataObject;
                                        rpioHttp:requestHeader <http://data.lblod.info/request-headers/accept/text/html>;
                                        mu:uuid ${sparqlEscapeString(remoteDataId)};
                                        nie:url ${sparqlEscapeUri(locationUrl)};
                                        dct:creator <http://lblod.data.gift/services/automatic-submission-service>;
                                        adms:status <http://lblod.data.gift/file-download-statuses/ready-to-be-cached>;
                                        dct:created ${sparqlEscapeDateTime(timestamp)};
                                        dct:modified ${sparqlEscapeDateTime(timestamp)}.

   <http://data.lblod.info/request-headers/accept/text/html> a http:RequestHeader;
                                                                      http:fieldValue "text/html";
                                                                      http:fieldName "Accept";
                                                                      http:hdrName <http://www.w3.org/2011/http-headers#accept>.
  }

  GRAPH ${sparqlEscapeUri(submissionGraph)} {
     ${sparqlEscapeUri(meldingUri)} nie:hasPart ${sparqlEscapeUri(remoteDataUri)}.
  }
}
`);

  //update created-at/modified-at for submission
  await update(`
    ${PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
          ${sparqlEscapeUri(extractSubmissionUrl(triples))}  dct:created  ${sparqlEscapeDateTime(new Date())}.
          ${sparqlEscapeUri(extractSubmissionUrl(triples))}  dct:modified ${sparqlEscapeDateTime(new Date())}.
      }
    }
  `);

  return taskUri;
}

async function verifyKeyAndOrganisation(vendor, key, organisation) {
  const result = await query(`
${PREFIXES}
SELECT ?organisationID WHERE  {
  GRAPH <http://mu.semte.ch/graphs/automatic-submission> {
    ${sparqlEscapeUri(vendor)} a foaf:Agent;
           muAccount:key ${sparqlEscapeString(key)};
           muAccount:canActOnBehalfOf ${sparqlEscapeUri(organisation)}.
   }
   ${sparqlEscapeUri(organisation)} mu:uuid ?organisationID.
}`);
  if (result.results.bindings.length === 1) {
    return result.results.bindings[0].organisationID.value;
  } else {
    return null;
  }
}

export {isSubmitted, storeSubmission, verifyKeyAndOrganisation}
