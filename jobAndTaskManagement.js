import * as cts from './automatic-submission-flow-tools/constants.js';
import * as jbt from './automatic-submission-flow-tools/jobs.js';
import * as tsk from './automatic-submission-flow-tools/tasks.js';
import { querySudo as query } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri } from 'mu';
import { downloadTaskCreate } from './downloadTaskManagement.js';
import { SparqlJsonParser } from 'sparqljson-parse';
import * as N3 from 'n3';
const { quad, namedNode } = N3.DataFactory;

export async function startJob(submissionGraph, meldingUri) {
  const submission = namedNode(meldingUri);
  const graph = namedNode(submissionGraph);
  const creator = namedNode(cts.SERVICES.automaticSubmission);
  const operation = namedNode(cts.OPERATIONS.register);
  const status = namedNode(cts.TASK_STATUSES.busy);
  const cogsOperation = namedNode(cts.COGS_OPERATION.transformation);
  // Make a cogs:Job for the whole process
  const job = await jbt.create(submission, creator, graph);
  // Create a task for the automatic submission as the first step in the flow
  const task = await tsk.create(
    operation,
    creator,
    status,
    0,
    job,
    graph,
    cogsOperation
  );
  return { job, task };
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
  const store = await jbt.getStatusFromActivity(submission);
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
  await tsk.updateStatus(
    namedNode(automaticSubmissionTaskUri),
    namedNode(cts.TASK_STATUSES.success),
    namedNode(cts.SERVICES.automaticSubmission),
    { remoteDataObjects: [namedNode(remoteDataObjectUri)] }
  );
}

export async function automaticSubmissionTaskFail(
  submissionGraph,
  automaticSubmissionTaskUri,
  jobUri,
  errorUri
) {
  const status = namedNode(cts.JOB_STATUSES.failed);
  const error = namedNode(errorUri);
  //Set the task to failed
  await tsk.updateStatus(
    namedNode(automaticSubmissionTaskUri),
    status,
    namedNode(cts.SERVICES.automaticSubmission),
    undefined,
    error
  );
  //Also set the job to failure
  await jbt.updateStatus(namedNode(jobUri), status, error);
}
