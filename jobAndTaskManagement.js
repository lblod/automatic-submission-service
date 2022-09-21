import * as cts from './automatic-submission-flow-tools/constants.js';
import * as jbt from './automatic-submission-flow-tools/asfJobs.js';
import * as tsk from './automatic-submission-flow-tools/asfTasks.js';
import { querySudo as query, querySudo as update } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri } from 'mu';
import { SparqlJsonParser } from 'sparqljson-parse';
import * as N3 from 'n3';
const { quad, namedNode } = N3.DataFactory;

///////////////////////////////////////////////////////////////////////////////
// Submission Status
///////////////////////////////////////////////////////////////////////////////

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

///////////////////////////////////////////////////////////////////////////////
// Register Tasks
///////////////////////////////////////////////////////////////////////////////

export async function automaticSubmissionTaskStart(graphUri, meldingUri) {
  const creator = namedNode(cts.SERVICES.automaticSubmission);
  const graph = namedNode(graphUri);
  // First make a cogs:Job for the whole process
  const job = await jbt.create(
    namedNode(meldingUri),
    namedNode(cts.SERVICES.automaticSubmission),
    graph
  );
  // Create a task for the automatic submission as the first step in the flow
  const task = await tsk.create(
    namedNode(cts.OPERATIONS.register),
    creator,
    namedNode(cts.TASK_STATUSES.busy),
    0,
    job,
    undefined,
    namedNode(cts.COGS_OPERATIONS.transformation),
    graph
  );
  return { job, task };
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

///////////////////////////////////////////////////////////////////////////////
// Files
///////////////////////////////////////////////////////////////////////////////

//TODO in the future: maybe remove if better implemented in download-url-service
//The download-url-service is not very good at putting the metadata of a file in the correct place.
//The physical file gets al the metadata and the logical file (which is a remote data object) does not get additional file related metadata.
//We can just copy the metadata from the physical file to the logical file.
async function complementLogicalFileMetaData(
  submissionGraph,
  physicalFileUri,
  logicalFileUri
) {
  const submissionGraphSparql = sparqlEscapeUri(submissionGraph);
  return update(`
    ${cts.SPARQL_PREFIXES}
    INSERT {
      GRAPH ${submissionGraphSparql} {
        ${sparqlEscapeUri(logicalFileUri)}
          a nfo:FileDataObject ;
          nfo:fileName ?filename ;
          dct:format ?format ;
          nfo:fileSize ?fileSize ;
          dbpedia:fileExtension ?fileExtension ;
          dct:created ?created .
      }
    }
    WHERE {
      GRAPH ${submissionGraphSparql} {
        ${sparqlEscapeUri(physicalFileUri)}
          a nfo:FileDataObject ;
          nfo:fileName ?filename ;
          dct:format ?format ;
          nfo:fileSize ?fileSize ;
          dbpedia:fileExtension ?fileExtension ;
          dct:created ?created .
      }
    }
  `);
}

///////////////////////////////////////////////////////////////////////////////
// Download Tasks
///////////////////////////////////////////////////////////////////////////////

export async function getTaskInfoFromRemoteDataObject(remoteDataObjectUri) {
  const infoObject = await tsk.getTaskInfoFromRemoteDataObject(
    namedNode(remoteDataObjectUri)
  );
  if (!infoObject)
    throw new Error(
      `Could not find task and other necessary related information for remote data object ${remoteDataObjectUri}.`
    );
  return infoObject;
}

export async function downloadTaskUpdate(
  submissionGraph,
  downloadTaskUri,
  jobUri,
  oldASSStatus,
  newDLStatus,
  logicalFileUri,
  physicalFileUri,
  errorMsg
) {
  switch (newDLStatus) {
    case cts.DOWNLOAD_STATUSES.ongoing:
      if (oldASSStatus === cts.TASK_STATUSES.scheduled)
        return downloadStarted(downloadTaskUri);
      break;
    case cts.DOWNLOAD_STATUSES.success:
      if (
        oldASSStatus === cts.TASK_STATUSES.scheduled ||
        oldASSStatus === cts.TASK_STATUSES.busy
      ) {
        await complementLogicalFileMetaData(
          submissionGraph,
          physicalFileUri,
          logicalFileUri
        );
        return downloadSuccess(downloadTaskUri, logicalFileUri);
      }
      break;
    case cts.DOWNLOAD_STATUSES.failure:
      if (
        oldASSStatus === cts.TASK_STATUSES.busy ||
        oldASSStatus === cts.TASK_STATUSES.scheduled
      )
        return downloadFail(downloadTaskUri, jobUri, logicalFileUri, errorMsg);
      break;
  }
  throw new Error(
    `Download task ${downloadTaskUri} is being set to an unknown status ${newDLStatus} OR the transition to that status from ${oldASSStatus} is not allowed. This is related to job ${jobUri}.`
  );
}

export async function downloadTaskCreate(
  submissionGraph,
  jobUri,
  remoteDataObjectUri
) {
  const downloadTask = await tsk.create(
    namedNode(cts.OPERATIONS.download),
    namedNode(cts.SERVICES.automaticSubmission),
    namedNode(cts.TASK_STATUSES.scheduled),
    1,
    namedNode(jobUri),
    { remoteDataObjects: [namedNode(remoteDataObjectUri)] },
    namedNode(cts.COGS_OPERATIONS.webServiceLookup),
    namedNode(submissionGraph)
  );
  return downloadTask;
}

async function downloadStarted(downloadTaskUri) {
  await tsk.updateStatus(
    namedNode(downloadTaskUri),
    namedNode(cts.TASK_STATUSES.busy),
    namedNode(cts.SERVICES.automaticSubmission)
  );
}

async function downloadSuccess(downloadTaskUri, logicalFileUri) {
  await tsk.updateStatus(
    namedNode(downloadTaskUri),
    namedNode(cts.TASK_STATUSES.success),
    namedNode(cts.SERVICES.automaticSubmission),
    { files: [namedNode(logicalFileUri)] }
  );
}

async function downloadFail(downloadTaskUri, jobUri, logicalFileUri, error) {
  //Set task to failure
  await tsk.updateStatus(
    namedNode(downloadTaskUri),
    namedNode(cts.TASK_STATUSES.success),
    namedNode(cts.SERVICES.automaticSubmission),
    { files: [namedNode(logicalFileUri)] },
    namedNode(error)
  );

  //Also set the job to failure
  await jbt.updateStatus(
    namedNode(jobUri),
    namedNode(cts.JOB_STATUSES.failed),
    error
  );
}
