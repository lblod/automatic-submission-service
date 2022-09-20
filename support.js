import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import {
  uuid,
  sparqlEscapeString,
  sparqlEscapeDateTime,
  sparqlEscapeUri,
} from 'mu';
import { downloadTaskCreate } from './downloadTaskManagement.js';
import * as env from './env.js';
import * as cts from './automatic-submission-flow-tools/constants.js';
import * as err from './automatic-submission-flow-tools/errors.js';
import * as jobsAndTasks from './jobAndTaskManagement.js';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

export async function isSubmitted(resource) {
  const result = await query(`
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

    SELECT (COUNT(*) as ?count)
    WHERE {
        ${sparqlEscapeUri(resource)} ?p ?o .
    }`);
  return parseInt(result.results.bindings[0].count.value) > 0;
}

function extractSubmissionUrl(store) {
  const submissionUrls = store.getSubjects(
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://rdf.myexperiment.org/ontologies/base/Submission')
  );
  return submissionUrls[0]?.value;
}

function findSubmittedResource(store) {
  const submittedResources = store.getObjects(
    undefined,
    namedNode('http://purl.org/dc/terms/subject')
  );
  return submittedResources[0]?.value;
}

function extractLocationUrl(store) {
  const locations = store.getObjects(
    undefined,
    namedNode('http://www.w3.org/ns/prov#atLocation')
  );
  return locations[0]?.value;
}

function extractMeldingUri(store) {
  const submissionUris = store.getSubjects(
    undefined,
    namedNode('http://rdf.myexperiment.org/ontologies/base/Submission')
  );
  return submissionUris[0]?.value;
}

async function storeToTurtle(store) {
  const vendors = store.getObjects(
    undefined,
    namedNode('http://purl.org/pav/providedBy')
  );
  const vendor = vendors[0];
  const storeCopy = new N3.Store();
  storeCopy.addQuads([...store]);
  const toRemove = storeCopy.getQuads(vendor);
  storeCopy.removeQuads(toRemove);
  const writer = new N3.Writer({ format: 'application/n-quads' });
  storeCopy.forEach((quad) => writer.addQuad(quad));
  const ttl = await new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
  return ttl;
}

export async function storeSubmission(
  store,
  submissionGraph,
  fileGraph,
  authenticationConfiguration
) {
  let newAuthConf = {};
  const meldingUri = extractMeldingUri(store);
  const { job, task } = await jobsAndTasks.startJob(
    submissionGraph,
    meldingUri
  );
  try {
    const submittedResource = findSubmittedResource(store);
    const turtle = await storeToTurtle(store);
    await update(`
      ${cts.SPARQL_PREFIXES}
      INSERT DATA {
        GRAPH ${sparqlEscapeUri(submissionGraph)} {
           ${turtle}
           ${sparqlEscapeUri(submittedResource)}
             a foaf:Document, ext:SubmissionDocument .
        }
      }`);
    //TODO: Is this following query really necessary? A submission always gets a uuid whith enrichBody so this query seems redundant.
    await update(`
      ${cts.SPARQL_PREFIXES}
      INSERT {
        GRAPH ${sparqlEscapeUri(submissionGraph)} {
          ${sparqlEscapeUri(submittedResource)}
           mu:uuid ${sparqlEscapeString(uuid())} .
        }
      } WHERE {
        GRAPH ${sparqlEscapeUri(submissionGraph)} {
          ${sparqlEscapeUri(submittedResource)}
           a foaf:Document .
          FILTER NOT EXISTS {
            ${sparqlEscapeUri(submittedResource)} mu:uuid ?uuid . }
        }
      }`);
    const timestampSparql = sparqlEscapeDateTime(new Date());
    const remoteDataId = uuid();
    const remoteDataUri = `http://data.lblod.info/id/remote-data-objects/${remoteDataId}`;
    const locationUrl = extractLocationUrl(store);

    // We need to attach a cloned version of the authentication data, because:
    // 1. donwloadUrl will delete credentials after final state
    // 2. in a later phase, when attachments are fetched, these need to be reused.
    // -> If not cloned, the credentials might not be availible for the download of the attachments
    // Alternative: not delete the credentials after download, but the not always clear when exaclty query may be deleted.
    // E.g. after import-submission we're quite sure. But what if something goes wrong before that, or a download just takes longer.
    // The highly aync process makes it complicated
    // Note: probably some clean up background job might be needed. Needs perhaps a bit of better thinking
    newAuthConf = await attachClonedAuthenticationConfiguraton(
      remoteDataUri,
      meldingUri,
      fileGraph
    );

    await downloadTaskCreate(submissionGraph, job.value, remoteDataUri);

    await update(`
      ${cts.SPARQL_PREFIXES}
      INSERT DATA {
        GRAPH ${sparqlEscapeUri(fileGraph)} {
          ${sparqlEscapeUri(remoteDataUri)}
            a nfo:RemoteDataObject,
              nfo:FileDataObject;
            rpioHttp:requestHeader <http://data.lblod.info/request-headers/accept/text/html>;
            mu:uuid ${sparqlEscapeString(remoteDataId)};
            nie:url ${sparqlEscapeUri(locationUrl)};
            dct:creator ${sparqlEscapeUri(cts.SERVICES.automaticSubmission)};
            adms:status <http://lblod.data.gift/file-download-statuses/ready-to-be-cached>;
            dct:created ${timestampSparql};
            dct:modified ${timestampSparql}.

         <http://data.lblod.info/request-headers/accept/text/html>
          a http:RequestHeader;
          http:fieldValue "text/html";
          http:fieldName "Accept";
          http:hdrName <http://www.w3.org/2011/http-headers#accept>.
        }
        GRAPH ${sparqlEscapeUri(submissionGraph)} {
          ${sparqlEscapeUri(meldingUri)}
            nie:hasPart ${sparqlEscapeUri(remoteDataUri)}.
        }
      }`);

    //update created-at/modified-at for submission
    await update(`
      ${cts.SPARQL_PREFIXES}
      INSERT DATA {
        GRAPH ${sparqlEscapeUri(submissionGraph)} {
          ${sparqlEscapeUri(extractSubmissionUrl(store))}
            dct:created  ${timestampSparql};
            dct:modified ${timestampSparql}.
        }
      }
    `);

    await jobsAndTasks.automaticSubmissionTaskSuccess(
      submissionGraph,
      task.value,
      job.value,
      remoteDataUri
    );

    return { submissionUri: meldingUri, jobUri: job.value };
  } catch (e) {
    console.error(
      `Something went wrong during the storage of submission ${meldingUri}. This is monitored via task ${task.value}.`
    );
    console.error(e.message);
    console.info('Cleaning credentials');
    const error = await err.create(
      `Something went wrong during the storage of submission ${meldingUri}. This is monitored via task ${task.value}.`,
      e.message
    );
    await jobsAndTasks.automaticSubmissionTaskFail(
      submissionGraph,
      task.value,
      job.value,
      error.value
    );
    e.alreadyStoredError = true;
    if (authenticationConfiguration)
      await cleanCredentials(authenticationConfiguration);
    if (newAuthConf?.newAuthConf) {
      await cleanCredentials(newAuthConf.newAuthConf);
    }
    throw e;
  }
}

async function attachClonedAuthenticationConfiguraton(
  remoteDataObjectUri,
  submissionUri,
  remoteObjectGraph
) {
  const getInfoQuery = `
    ${cts.SPARQL_PREFIXES}
    SELECT DISTINCT ?graph ?secType ?authenticationConfiguration WHERE {
      GRAPH ?graph {
        ${sparqlEscapeUri(submissionUri)}
          dgftSec:targetAuthenticationConfiguration ?authenticationConfiguration .
        ?authenticationConfiguration
          dgftSec:securityConfiguration/rdf:type ?secType .
      }
    }`;

  const authData = parseResult(await query(getInfoQuery))[0];
  const newAuthConf = `http://data.lblod.info/authentications/${uuid()}`;
  const newConf = `http://data.lblod.info/configurations/${uuid()}`;
  const newCreds = `http://data.lblod.info/credentials/${uuid()}`;

  let cloneQuery = '';

  if (!authData) {
    return;
  } else if (authData.secType === env.BASIC_AUTH) {
    cloneQuery = `
      ${cts.SPARQL_PREFIXES}
      INSERT {
        GRAPH ${sparqlEscapeUri(remoteObjectGraph)} {
          ${sparqlEscapeUri(remoteDataObjectUri)}
            dgftSec:targetAuthenticationConfiguration
              ${sparqlEscapeUri(newAuthConf)} .
        }
        GRAPH ${sparqlEscapeUri(authData.graph)} {
          ${sparqlEscapeUri(newAuthConf)}
            dgftSec:secrets ${sparqlEscapeUri(newCreds)} .
          ${sparqlEscapeUri(newCreds)}
            meb:username ?user ;
            muAccount:password ?pass .
          ${sparqlEscapeUri(newAuthConf)}
            dgftSec:securityConfiguration ${sparqlEscapeUri(newConf)} .
          ${sparqlEscapeUri(newConf)}
            ?srcConfP ?srcConfO .
        }
      }
      WHERE {
        ${sparqlEscapeUri(authData.authenticationConfiguration)}
          dgftSec:securityConfiguration ?srcConfg.
        ?srcConfg
          ?srcConfP ?srcConfO.
        ${sparqlEscapeUri(authData.authenticationConfiguration)}
          dgftSec:secrets ?srcSecrets.
        ?srcSecrets
          meb:username ?user ;
          muAccount:password ?pass .
     }
   `;
  } else if (authData.secType == env.OAUTH2) {
    cloneQuery = `
      ${cts.SPARQL_PREFIXES}
      INSERT {
        GRAPH ${sparqlEscapeUri(remoteObjectGraph)} {
          ${sparqlEscapeUri(remoteDataObjectUri)}
            dgftSec:targetAuthenticationConfiguration
              ${sparqlEscapeUri(newAuthConf)} .
        }
        GRAPH ${sparqlEscapeUri(authData.graph)} {
          ${sparqlEscapeUri(newAuthConf)}
            dgftSec:secrets ${sparqlEscapeUri(newCreds)} .
          ${sparqlEscapeUri(newCreds)}
            dgftOauth:clientId ?clientId ;
            dgftOauth:clientSecret ?clientSecret .
          ${sparqlEscapeUri(newAuthConf)}
            dgftSec:securityConfiguration ${sparqlEscapeUri(newConf)} .
          ${sparqlEscapeUri(newConf)}
            ?srcConfP ?srcConfO .
        }
      }
      WHERE {
        ${sparqlEscapeUri(authData.authenticationConfiguration)}
          dgftSec:securityConfiguration ?srcConfg .
        ?srcConfg
          ?srcConfP ?srcConfO .
        ${sparqlEscapeUri(authData.authenticationConfiguration)}
          dgftSec:secrets ?srcSecrets .
        ?srcSecrets
          dgftOauth:clientId ?clientId ;
          dgftOauth:clientSecret ?clientSecret .
     }`;
  } else {
    throw `Unsupported Security type ${authData.secType}`;
  }

  await update(cloneQuery);

  return { newAuthConf, newConf, newCreds };
}

async function cleanCredentials(authenticationConfigurationUri) {
  let cleanQuery = `
    ${cts.SPARQL_PREFIXES}
    DELETE {
      GRAPH ?g {
        ?srcSecrets ?secretsP ?secretsO.
      }
    }
    WHERE {
      GRAPH ?g {
        ${sparqlEscapeUri(authenticationConfigurationUri)}
          dgftSec:secrets ?srcSecrets.
        ?srcSecrets
          ?secretsP ?secretsO.
     }
   }`;
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
      if (
        row[key] &&
        row[key].datatype == 'http://www.w3.org/2001/XMLSchema#integer' &&
        row[key].value
      ) {
        obj[key] = parseInt(row[key].value);
      } else if (
        row[key] &&
        row[key].datatype == 'http://www.w3.org/2001/XMLSchema#dateTime' &&
        row[key].value
      ) {
        obj[key] = new Date(row[key].value);
      } else obj[key] = row[key] ? row[key].value : undefined;
    });
    return obj;
  });
}

export async function verifyKeyAndOrganisation(vendor, key, organisation) {
  const result = await query(`
    ${cts.SPARQL_PREFIXES}
    SELECT DISTINCT ?organisationID WHERE  {
      GRAPH <http://mu.semte.ch/graphs/automatic-submission> {
        ${sparqlEscapeUri(vendor)}
          a foaf:Agent;
          muAccount:key ${sparqlEscapeString(key)};
          muAccount:canActOnBehalfOf ${sparqlEscapeUri(organisation)}.
      }
      ${sparqlEscapeUri(organisation)}
        mu:uuid ?organisationID.
    }`);
  if (result.results.bindings.length === 1) {
    return result.results.bindings[0].organisationID.value;
  }
}

export function cleanseRequestBody(body) {
  const cleansed = body;
  delete cleansed.authentication;
  delete cleansed.publisher.key;
  return cleansed;
}
