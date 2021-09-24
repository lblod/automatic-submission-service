import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {uuid, sparqlEscapeString, sparqlEscapeDateTime} from 'mu';
import {Writer} from 'n3';

const BASIC_AUTH = 'https://www.w3.org/2019/wot/security#BasicSecurityScheme';
const OAUTH2 = 'https://www.w3.org/2019/wot/security#OAuth2SecurityScheme';

//Patched sparqlEscapeUri, see https://github.com/mu-semtech/mu-javascript-template/pull/34/files
const sparqlEscapeUri = function( value ){
  console.log('Warning: using a monkey patched sparqlEscapeUri.');
  return `<${value.replace(/[\\"<>]/g, (match) => `\\${match}`)}>`;
};

const PREFIXES = `
  PREFIX meb:   <http://rdf.myexperiment.org/ontologies/base/>
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
  PREFIX dgftSec: <http://lblod.data.gift/vocabularies/security/>
  PREFIX dgftOauth: <http://kanselarij.vo.data.gift/vocabularies/oauth-2.0-session/>
  PREFIX wotSec: <https://www.w3.org/2019/wot/security#>
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

async function storeSubmission(triples, submissionGraph, fileGraph, authenticationConfiguration) {
  let newAuthConf = {};
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
  catch(e){
    console.error('Something went wrong during the storage of submission');
    console.error(e);
    console.info('Cleaning credentials');
    await cleanCredentials(authenticationConfiguration);
    if(newAuthConf.newAuthConf){
      await cleanCredentials(newAuthConf.newAuthConf);
    }
    throw e;
  }
}

async function attachClonedAuthenticationConfiguraton(remoteDataObjectUri, submissionUri, remoteObjectGraph){
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

  if(!authData){
    return null;
  }
  else if(authData.secType === BASIC_AUTH){
    cloneQuery = `
      ${PREFIXES}
      INSERT {
        GRAPH ${sparqlEscapeUri(remoteObjectGraph)} {
          ${sparqlEscapeUri(remoteDataObjectUri)} dgftSec:targetAuthenticationConfiguration ${sparqlEscapeUri(newAuthConf)} .
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
  }
  else if(authData.secType == OAUTH2){
    cloneQuery = `
      ${PREFIXES}
      INSERT {
        GRAPH ${sparqlEscapeUri(remoteObjectGraph)} {
          ${sparqlEscapeUri(remoteDataObjectUri)} dgftSec:targetAuthenticationConfiguration ${sparqlEscapeUri(newAuthConf)} .
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
  }
  else {
    throw `Unsupported Security type ${authData.secType}`;
  }

  await update(cloneQuery);

  return { newAuthConf, newConf, newCreds };
}

async function cleanCredentials(authenticationConfigurationUri){
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
 export function parseResult( result ) {
  if(!(result.results && result.results.bindings.length)) return [];

  const bindingKeys = result.head.vars;
  return result.results.bindings.map((row) => {
    const obj = {};
    bindingKeys.forEach((key) => {
      if(row[key] && row[key].datatype == 'http://www.w3.org/2001/XMLSchema#integer' && row[key].value){
        obj[key] = parseInt(row[key].value);
      }
      else if(row[key] && row[key].datatype == 'http://www.w3.org/2001/XMLSchema#dateTime' && row[key].value){
        obj[key] = new Date(row[key].value);
      }
      else obj[key] = row[key] ? row[key].value:undefined;
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

export {isSubmitted, storeSubmission, verifyKeyAndOrganisation}
