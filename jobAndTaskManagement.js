import * as cts from './automatic-submission-flow-tools/constants.js';
import * as jbt from './automatic-submission-flow-tools/jobs.js';
import * as env from './env.js';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import {
  uuid,
  sparqlEscapeString,
  sparqlEscapeDateTime,
  sparqlEscapeUri,
} from 'mu';
import { downloadTaskCreate } from './automatic-submission-flow-tools/downloadTaskManagement.js';
import { SparqlJsonParser } from 'sparqljson-parse';
import * as N3 from 'n3';
const { quad, namedNode } = N3.DataFactory;

export async function startJob(submissionGraph, meldingUri) {
  try {
    const submission = namedNode(meldingUri);
    const graph = namedNode(submissionGraph);
    const creator = namedNode(env.CREATOR);
    const job = await jbt.create(submission, creator, graph);

    // Create a task for the automatic submission as the first step in the flow
    const submissionTaskUuid = uuid();
    const nowSparql = sparqlEscapeDateTime(new Date());
    const submissionTaskQuery = `
      ${cts.SPARQL_PREFIXES}
      INSERT DATA {
        GRAPH ${sparqlEscapeUri(submissionGraph)} {
          asj:${submissionTaskUuid}
            a task:Task ;
            mu:uuid ${sparqlEscapeString(submissionTaskUuid)} ;
            adms:status js:busy ;
            dct:created ${nowSparql} ;
            dct:modified ${nowSparql} ;
            task:cogsOperation cogs:TransformationProcess ;
            task:operation tasko:register ;
            dct:creator services:automatic-submission-service ;
            task:index "0" ;
            dct:isPartOf ${sparqlEscapeUri(job.value)} .
        }
      }
    `;
    await update(submissionTaskQuery);

    const task = namedNode(cts.BASE_TABLE.job.concat(submissionTaskUuid));
    return { job, task };
  } catch (e) {
    console.error(e);
  }
}

const JobStatusContext = {
  cogs: 'http://vocab.deri.ie/cogs#',
  adms: 'http://www.w3.org/ns/adms#',
  prov: 'http://www.w3.org/ns/prov#',
  meb: 'http://rdf.myexperiment.org/ontologies/base/',
  oslc: 'http://open-services.net/ns/core#',
  task: 'http://redpencil.data.gift/vocabularies/tasks/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  status: {
    '@id': 'adms:status',
    '@type': '@id',
  },
  generated: {
    '@id': 'prov:generated',
    '@type': '@id',
  },
  error: {
    '@id': 'task:error',
    '@type': '@id',
  },
  message: {
    '@id': 'oslc:message',
    //Type string is implicit when nothing else specified.
    //Also, when including the following, the property becomes oslc:message instead of just message, for some reason.
    //"@type": "xsd:string",
  },
};
const JobStatusFrame = {
  '@context': {
    cogs: 'http://vocab.deri.ie/cogs#',
    adms: 'http://www.w3.org/ns/adms#',
    prov: 'http://www.w3.org/ns/prov#',
    meb: 'http://rdf.myexperiment.org/ontologies/base/',
    oslc: 'http://open-services.net/ns/core#',
    task: 'http://redpencil.data.gift/vocabularies/tasks/',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    status: {
      '@id': 'adms:status',
      '@type': '@id',
    },
    error: {
      '@id': 'task:error',
      '@type': 'oslc:Error',
    },
    generated: {
      '@id': 'prov:generated',
      '@type': 'meb:Submission',
    },
    message: {
      '@id': 'oslc:message',
      '@type': 'xsd:string',
    },
  },
  '@type': 'cogs:Job',
  generated: {
    '@embed': '@always',
  },
  error: {
    '@embed': '@always',
  },
};
export async function getSubmissionStatus(submissionUri) {
  const submission = namedNode(submissionUri);
  const store = await jbt.getStatus(submission);
  const response = await query(`
    ${cts.SPARQL_PREFIXES}
    CONSTRUCT {
      ${sparqlEscapeUri(submissionUri)}
        rdf:type meb:Submission ;
        adms:status ?submissionStatus .
    }
    WHERE {
      ${sparqlEscapeUri(submissionUri)}
        rdf:type meb:Submission ;
        adms:status ?submissionStatus .
    }
  `);
  const sparqlJsonParser = new SparqlJsonParser();
  const parsedResults = sparqlJsonParser.parseJsonResults(response);
  parsedResults.forEach((binding) =>
    store.addQuad(quad(binding.s, binding.p, binding.o))
  );
  return { statusStore: store, JobStatusContext, JobStatusFrame };
}

export async function automaticSubmissionTaskSuccess(
  submissionGraph,
  automaticSubmissionTaskUri,
  jobUri,
  remoteDataObjectUri
) {
  const nowSparql = sparqlEscapeDateTime(new Date().toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(
    automaticSubmissionTaskUri
  );
  const resultContainerUuid = uuid();
  const harvestingCollectionUuid = uuid();
  const assTaskQuery = `
    ${cts.SPARQL_PREFIXES}
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
          mu:uuid ${sparqlEscapeString(resultContainerUuid)} ;
          task:hasHarvestingCollection asj:${harvestingCollectionUuid} .

        asj:${harvestingCollectionUuid}
          a hrvst:HarvestingCollection ;
          dct:creator services:automatic-submission-service ;
          dct:hasPart ${sparqlEscapeUri(remoteDataObjectUri)} .
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

  return downloadTaskCreate(submissionGraph, jobUri, remoteDataObjectUri);
}

export async function automaticSubmissionTaskFail(
  submissionGraph,
  automaticSubmissionTaskUri,
  jobUri,
  errorUri
) {
  const nowSparql = sparqlEscapeDateTime(new Date().toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(
    automaticSubmissionTaskUri
  );
  const errorUriSparql = sparqlEscapeUri(errorUri);
  const assTaskQuery = `
    ${cts.SPARQL_PREFIXES}
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
          dct:modified ${nowSparql} ;
          task:error ${errorUriSparql} .
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

  //Also set the job to failure
  const job = namedNode(jobUri);
  const status = namedNode(cts.JOB_STATUSES.failed);
  const error = namedNode(errorUri);
  await job.updateStatus(job, status, error);
}
