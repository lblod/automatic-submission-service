import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { uuid, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';
import { Writer } from 'n3';
import { previousMap } from './helpers.js';

const BASIC_AUTH = 'https://www.w3.org/2019/wot/security#BasicSecurityScheme';
const OAUTH2 = 'https://www.w3.org/2019/wot/security#OAuth2SecurityScheme';

const CREATOR = 'http://lblod.data.gift/services/automatic-submission-service';

const PREFIXES = `
  PREFIX meb:          <http://rdf.myexperiment.org/ontologies/base/>
  PREFIX xsd:          <http://www.w3.org/2001/XMLSchema#>
  PREFIX pav:          <http://purl.org/pav/>
  PREFIX dct:          <http://purl.org/dc/terms/>
  PREFIX melding:      <http://lblod.data.gift/vocabularies/automatische-melding/>
  PREFIX lblodBesluit: <http://lblod.data.gift/vocabularies/besluit/>
  PREFIX adms:         <http://www.w3.org/ns/adms#>
  PREFIX muAccount:    <http://mu.semte.ch/vocabularies/account/>
  PREFIX eli:          <http://data.europa.eu/eli/ontology#>
  PREFIX org:          <http://www.w3.org/ns/org#>
  PREFIX elod:         <http://linkedeconomy.org/ontology#>
  PREFIX nie:          <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
  PREFIX prov:         <http://www.w3.org/ns/prov#>
  PREFIX mu:           <http://mu.semte.ch/vocabularies/core/>
  PREFIX foaf:         <http://xmlns.com/foaf/0.1/>
  PREFIX nfo:          <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX ext:          <http://mu.semte.ch/vocabularies/ext/>
  PREFIX http:         <http://www.w3.org/2011/http#>
  PREFIX rpioHttp:     <http://redpencil.data.gift/vocabularies/http/>
  PREFIX dgftSec:      <http://lblod.data.gift/vocabularies/security/>
  PREFIX dgftOauth:    <http://kanselarij.vo.data.gift/vocabularies/oauth-2.0-session/>
  PREFIX wotSec:       <https://www.w3.org/2019/wot/security#>
  PREFIX cogs:         <http://vocab.deri.ie/cogs#>
  PREFIX asj:          <http://data.lblod.info/id/automatic-submission-job/>
  PREFIX services:     <http://lblod.data.gift/services/>
  PREFIX job:          <http://lblod.data.gift/jobs/>
  PREFIX task:         <http://redpencil.data.gift/vocabularies/tasks/>
  PREFIX js:           <http://redpencil.data.gift/id/concept/JobStatus/>
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
      triple.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
      triple.object.value === 'http://rdf.myexperiment.org/ontologies/base/Submission'
  ).subject.value;
}

function findSubmittedResource(triples) {
  return triples.find((triple) => triple.predicate.value === 'http://purl.org/dc/terms/subject').object.value;
}

function extractLocationUrl(triples) {
  return triples.find((triple) => triple.predicate.value === 'http://www.w3.org/ns/prov#atLocation').object.value;
}

function extractMeldingUri(triples) {
  return triples.find(
      (triple) => triple.object.value === 'http://rdf.myexperiment.org/ontologies/base/Submission').subject.value;
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

async function startJob(submissionGraph, meldingUri) {
  const jobUuid = uuid();
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  // Make a cogs:Job for the whole process
  // The prov:generated is strictly not necessary for the model, maybe nice to have
  const jobQuery = `
    ${PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        asj:${jobUuid}
          a cogs:Job ;
          mu:uuid ${sparqlEscapeString(jobUuid)} ;
          dct:creator services:automatic-submission-service ;
          adms:status js:busy ;
          dct:created ${nowSparql} ;
          dct:modified ${nowSparql} ;
          task:operation cogs:TransformationProcess ;
          prov:generated ${sparqlEscapeUri(meldingUri)} .
      }
    }
  `;
  await update(jobQuery);

  // Create a task for the automatic submission as the first step in the flow
  const submissionTaskUuid = uuid();
  const submissionTaskQuery = `
    ${PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        asj:${submissionTaskUuid}
          a task:Task ;
          mu:uuid ${sparqlEscapeString(submissionTaskUuid)} ;
          adms:status js:busy ;
          dct:created ${nowSparql} ;
          dct:modified ${nowSparql} ;
          task:operation cogs:TransformationProcess ;
          dct:creator services:automatic-submission-service ;
          task:index "0" ;
          dct:isPartOf asj:${jobUuid} .
      }
    }
  `;
  await update(submissionTaskQuery);

  const jobUri = `http://data.lblod.info/id/automatic-submission-job/${jobUuid}`
  const automaticSubmissionTaskUri = `http://data.lblod.info/id/automatic-submission-job/${submissionTaskUuid}`;
  return { jobUri, automaticSubmissionTaskUri, };
}

async function automaticSubmissionTaskSuccess(submissionGraph, automaticSubmissionTaskUri, jobUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(automaticSubmissionTaskUri);
  const resultContainerUuid = uuid();
  const assTaskQuery = `
    ${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${automaticSubmissionTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
    INSERT {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${automaticSubmissionTaskUriSparql}
          adms:status js:success ;
          dct:modified ${nowSparql} ;
          task:resultsContainer asj:${resultContainerUuid} .

        asj:${resultContainerUuid}
          a nfo:DataContainer ;
          mu:uuid ${sparqlEscapeString(resultContainerUuid)} .
      }
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${automaticSubmissionTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
  `;
  await update(assTaskQuery);

  const downloadTaskUuid = uuid();
  const inputContainerUuid = uuid();
  const downloadTaskQuery = `
    ${PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        asj:${downloadTaskUuid}
          a task:Task ;
          mu:uuid ${sparqlEscapeString(downloadTaskUuid)} ;
          adms:status js:busy ;
          dct:created ${nowSparql} ;
          dct:modified ${nowSparql} ;
          task:operation cogs:WebServiceLookup ;
          dct:creator services:automatic-submission-service ;
          task:index "1" ;
          dct:isPartOf ${sparqlEscapeUri(jobUri)} ;
          task:inputContainer asj:${inputContainerUuid} .

        asj:j${inputContainerUuid}
          a nfo:DataContainer ;
          mu:uuid ${sparqlEscapeString(inputContainerUuid)} .
      }
    }
  `;
  await update(downloadTaskQuery);
  
  const downloadTaskUri = `http://data.lblod.info/id/automatic-submission-job/${downloadTaskUuid}`;
  return downloadTaskUri;
}

async function automaticSubmissionTaskFail(submissionGraph, automaticSubmissionTaskUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(automaticSubmissionTaskUri);
  const assTaskQuery = `
    ${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${automaticSubmissionTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
    INSERT {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${automaticSubmissionTaskUriSparql}
          adms:status js:failed ;
          dct:modified ${nowSparql} .
      }
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${automaticSubmissionTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
  `;
  await update(assTaskQuery);
}

async function downloadSuccess(submissionGraph, downloadTaskUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const resultContainerUuid = uuid();
  const downloadTaskUriSparql = sparqlEscapeUri(downloadTaskUri);
  const downloadTaskQuery = `
    ${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${downloadTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
    INSERT {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${downloadTaskUriSparql}
          adms:status js:success ;
          dct:modified ${nowSparql} ;
          task:resultsContainer asj:${resultContainerUuid} .

        asj:${resultContainerUuid}
          a nfo:DataContainer ;
          mu:uuid ${sparqlEscapeString(resultContainerUuid)} .
      }
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${downloadTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
  `;
  await update(downloadTaskQuery);
}

async function downloadFail(submissionGraph, downloadTaskUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const downloadTaskUriSparql = sparqlEscapeUri(downloadTaskUri);
  const downloadTaskQuery = `
    ${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${downloadTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
    INSERT {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${downloadTaskUriSparql}
          adms:status js:failed ;
          dct:modified ${nowSparql} .
      }
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${downloadTaskUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
  `;
  await update(downloadTaskQuery);
}

async function storeSubmission(triples, submissionGraph, fileGraph, authenticationConfiguration) {
  let newAuthConf = {};
  const meldingUri = extractMeldingUri(triples);
  const { jobUri, automaticSubmissionTaskUri, } = await startJob(submissionGraph, meldingUri);
  try {
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
    //TODO: Is this following query really necessary? A submission always gets a uuid whith enrichBody so this query seems redundant.
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
    const timestamp = new Date();
    const remoteDataId = uuid();
    const remoteDataUri = `http://data.lblod.info/id/remote-data-objects/${remoteDataId}`;
    const locationUrl = extractLocationUrl(triples);

    // We need to attach a cloned version of the authentication data, because:
    // 1. donwloadUrl will delete credentials after final state
    // 2. in a later phase, when attachments are fetched, these need to be reused.
    // -> If not cloned, the credentials might not be availible for the download of the attachments
    // Alternative: not delete the credentials after download, but the not always clear when exaclty query may be deleted.
    // E.g. after import-submission we're quite sure. But what if something goes wrong before that, or a download just takes longer.
    // The highly aync process makes it complicated
    // Note: probably some clean up background job might be needed. Needs perhaps a bit of better thinking
    newAuthConf = await attachClonedAuthenticationConfiguraton(remoteDataUri, meldingUri, fileGraph);

    await update(`
      ${PREFIXES}
      INSERT DATA {
        GRAPH ${sparqlEscapeUri(fileGraph)} {
            ${sparqlEscapeUri(remoteDataUri)} a nfo:RemoteDataObject, nfo:FileDataObject;
                                              rpioHttp:requestHeader <http://data.lblod.info/request-headers/accept/text/html>;
                                              mu:uuid ${sparqlEscapeString(remoteDataId)};
                                              nie:url ${sparqlEscapeUri(locationUrl)};
                                              dct:creator ${sparqlEscapeUri(CREATOR)};
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

    await automaticSubmissionTaskSuccess(submissionGraph, automaticSubmissionTaskUri, jobUri);

    return jobUri;
  } catch (e) {
    console.error('Something went wrong during the storage of submission');
    console.error(e);
    console.info('Cleaning credentials');
    await automaticSubmissionTaskFail(submissionGraph, automaticSubmissionTaskUri);
    await cleanCredentials(authenticationConfiguration);
    if (newAuthConf.newAuthConf) {
      await cleanCredentials(newAuthConf.newAuthConf);
    }
    throw e;
  }
}

async function attachClonedAuthenticationConfiguraton(remoteDataObjectUri, submissionUri, remoteObjectGraph) {
  const getInfoQuery = `
    ${PREFIXES}
    SELECT DISTINCT ?graph ?secType ?authenticationConfiguration WHERE {
     GRAPH ?graph {
       ${sparqlEscapeUri(submissionUri)} dgftSec:targetAuthenticationConfiguration ?authenticationConfiguration.
       ?authenticationConfiguration dgftSec:securityConfiguration/rdf:type ?secType .
     }
    }
  `;

  const authData = parseResult(await query(getInfoQuery))[0];
  const newAuthConf = `http://data.lblod.info/authentications/${uuid()}`;
  const newConf = `http://data.lblod.info/configurations/${uuid()}`;
  const newCreds = `http://data.lblod.info/credentials/${uuid()}`;

  let cloneQuery = ``;

  if (!authData) {
    return null;
  } else if (authData.secType === BASIC_AUTH) {
    cloneQuery = `
      ${PREFIXES}
      INSERT {
        GRAPH ${sparqlEscapeUri(remoteObjectGraph)} {
          ${sparqlEscapeUri(remoteDataObjectUri)} dgftSec:targetAuthenticationConfiguration ${sparqlEscapeUri(
        newAuthConf)} .
        }

        GRAPH ${sparqlEscapeUri(authData.graph)} {
          ${sparqlEscapeUri(newAuthConf)} dgftSec:secrets ${sparqlEscapeUri(newCreds)} .
          ${sparqlEscapeUri(newCreds)} meb:username ?user ;
            muAccount:password ?pass .

          ${sparqlEscapeUri(newAuthConf)} dgftSec:securityConfiguration ${sparqlEscapeUri(newConf)}.
          ${sparqlEscapeUri(newConf)} ?srcConfP ?srcConfO.
        }
      }
      WHERE {
        ${sparqlEscapeUri(authData.authenticationConfiguration)} dgftSec:securityConfiguration ?srcConfg.
        ?srcConfg ?srcConfP ?srcConfO.

       ${sparqlEscapeUri(authData.authenticationConfiguration)} dgftSec:secrets ?srcSecrets.
       ?srcSecrets  meb:username ?user ;
         muAccount:password ?pass .
     }
   `;
  } else if (authData.secType == OAUTH2) {
    cloneQuery = `
      ${PREFIXES}
      INSERT {
        GRAPH ${sparqlEscapeUri(remoteObjectGraph)} {
          ${sparqlEscapeUri(remoteDataObjectUri)} dgftSec:targetAuthenticationConfiguration ${sparqlEscapeUri(
        newAuthConf)} .
        }

        GRAPH ${sparqlEscapeUri(authData.graph)} {
          ${sparqlEscapeUri(newAuthConf)} dgftSec:secrets ${sparqlEscapeUri(newCreds)} .
          ${sparqlEscapeUri(newCreds)} dgftOauth:clientId ?clientId ;
            dgftOauth:clientSecret ?clientSecret .

          ${sparqlEscapeUri(newAuthConf)} dgftSec:securityConfiguration ${sparqlEscapeUri(newConf)}.
          ${sparqlEscapeUri(newConf)} ?srcConfP ?srcConfO.
        }
      }
      WHERE {
        ${sparqlEscapeUri(authData.authenticationConfiguration)} dgftSec:securityConfiguration ?srcConfg.
        ?srcConfg ?srcConfP ?srcConfO.

       ${sparqlEscapeUri(authData.authenticationConfiguration)} dgftSec:secrets ?srcSecrets.
       ?srcSecrets  dgftOauth:clientId ?clientId ;
         dgftOauth:clientSecret ?clientSecret .
     }
   `;
  } else {
    throw `Unsupported Security type ${authData.secType}`;
  }

  await update(cloneQuery);

  return {newAuthConf, newConf, newCreds};
}

async function cleanCredentials(authenticationConfigurationUri) {
  let cleanQuery = `
      ${PREFIXES}
      DELETE {
        GRAPH ?g {
          ?srcSecrets ?secretsP ?secretsO.
        }
      }
      WHERE {
        GRAPH ?g {
         ${sparqlEscapeUri(authenticationConfigurationUri)} dgftSec:secrets ?srcSecrets.
         ?srcSecrets ?secretsP ?secretsO.
       }
     }
   `;
  await update(cleanQuery);
}

/**
 * convert results of select query to an array of objects.
 * courtesy: Niels Vandekeybus & Felix
 * @method parseResult
 * @return {Array}
 */
export function parseResult(result) {
  if (!(result.results && result.results.bindings.length)) return [];

  const bindingKeys = result.head.vars;
  return result.results.bindings.map((row) => {
    const obj = {};
    bindingKeys.forEach((key) => {
      if (row[key] && row[key].datatype == 'http://www.w3.org/2001/XMLSchema#integer' && row[key].value) {
        obj[key] = parseInt(row[key].value);
      } else if (row[key] && row[key].datatype == 'http://www.w3.org/2001/XMLSchema#dateTime' && row[key].value) {
        obj[key] = new Date(row[key].value);
      } else obj[key] = row[key] ? row[key].value : undefined;
    });
    return obj;
  });
}

async function verifyKeyAndOrganisation(vendor, key, organisation) {
  const result = await query(`
    ${PREFIXES}
    SELECT DISTINCT ?organisationID WHERE  {
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

function cleanseRequestBody(body) {
  const cleansed = body;
  delete cleansed.authentication;
  delete cleansed.publisher.key;
  return cleansed;
}

async function sendErrorAlert({message, detail, reference}) {
  if (!message)
    throw 'Error needs a message describing what went wrong.';
  const id = uuid();
  const uri = `http://data.lblod.info/errors/${id}`;
  const q = `
      PREFIX mu:   <http://mu.semte.ch/vocabularies/core/>
      PREFIX oslc: <http://open-services.net/ns/core#>      
      PREFIX dct:  <http://purl.org/dc/terms/>
      
      INSERT DATA {
        GRAPH <http://mu.semte.ch/graphs/error> {
            ${sparqlEscapeUri(uri)} a oslc:Error ;
                    mu:uuid ${sparqlEscapeString(id)} ;
                    dct:subject ${sparqlEscapeString('Automatic Submission Service')} ;
                    oslc:message ${sparqlEscapeString(message)} ;
                    dct:created ${sparqlEscapeDateTime(new Date().toISOString())} ;
                    dct:creator ${sparqlEscapeUri(CREATOR)} .
            ${reference ? `${sparqlEscapeUri(uri)} dct:references ${sparqlEscapeUri(reference)} .` : ''}        
            ${detail ? `${sparqlEscapeUri(uri)} oslc:largePreview ${sparqlEscapeString(detail)} .` : ''}        
        }
      }
   `;
  try {
    await update(q);
  } catch (e) {
    console.warn(`[WARN] Something went wrong while trying to store an error.\nMessage: ${e}\nQuery: ${q}`);
  }
}

export { isSubmitted, storeSubmission, verifyKeyAndOrganisation, sendErrorAlert, cleanseRequestBody };
