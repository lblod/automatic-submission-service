import * as cts from './automatic-submission-flow-tools/constants.js';
import { updateSudo as update } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri } from 'mu';
import * as tsk from './automatic-submission-flow-tools/tasks.js';
import * as jbt from './automatic-submission-flow-tools/asfJobs.js';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

export async function getTaskInfoFromRemoteDataObject(remoteDataObjectUri) {
  const infoObject = await tsk.getTaskInfoFromRemoteDataObject(
    namedNode(remoteDataObjectUri)
  );
  if (!infoObject)
    throw new Error(
      `Could not find task and other necessary related information for remote data object ${remoteDataObjectUri}.`
    );
  return {
    downloadTaskUri: infoObject.task.value,
    jobUri: infoObject.job.value,
    oldStatus: infoObject.status.value,
    submissionGraph: infoObject.submissionGraph.value,
    fileUri: infoObject.file?.value,
    errorMsg: infoObject.errorMsg?.value,
  };
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
        return downloadStarted(submissionGraph, downloadTaskUri);
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
        return downloadSuccess(
          submissionGraph,
          downloadTaskUri,
          logicalFileUri
        );
      }
      break;
    case cts.DOWNLOAD_STATUSES.failure:
      if (
        oldASSStatus === cts.TASK_STATUSES.busy ||
        oldASSStatus === cts.TASK_STATUSES.scheduled
      )
        return downloadFail(
          submissionGraph,
          downloadTaskUri,
          jobUri,
          logicalFileUri,
          errorMsg
        );
      break;
  }
  throw new Error(
    `Download task ${downloadTaskUri} is being set to an unknown status ${newDLStatus} OR the transition to that status from ${oldASSStatus} is not allowed. This is related to job ${jobUri}.`
  );
}

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
    namedNode(submissionGraph),
    namedNode(cts.COGS_OPERATION.webServiceLookup)
  );
  return downloadTask;
}

async function downloadStarted(submissionGraph, downloadTaskUri) {
  await tsk.updateStatus(
    namedNode(downloadTaskUri),
    namedNode(cts.TASK_STATUSES.busy),
    namedNode(cts.SERVICES.automaticSubmission)
  );
}

async function downloadSuccess(
  submissionGraph,
  downloadTaskUri,
  logicalFileUri
) {
  await tsk.updateStatus(
    namedNode(downloadTaskUri),
    namedNode(cts.TASK_STATUSES.success),
    namedNode(cts.SERVICES.automaticSubmission),
    { files: [namedNode(logicalFileUri)] }
  );
}

async function downloadFail(
  submissionGraph,
  downloadTaskUri,
  jobUri,
  logicalFileUri,
  error
) {
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
