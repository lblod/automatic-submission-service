import * as env from './env.js';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import {
  uuid,
  sparqlEscapeString,
  sparqlEscapeDateTime,
  sparqlEscapeUri,
} from 'mu';

export async function getTaskInfoFromRemoteDataObject(remoteDataObjectUri) {
  const remoteDataObjectUriSparql = sparqlEscapeUri(remoteDataObjectUri);
  //TODO this query is rather fragile, relying on the links between melding, job and task via non-documented properties, made by the download-url-service
  const taskQuery = `
    ${env.PREFIXES}
    SELECT ?task ?job ?oldStatus ?submissionGraph ?fileUri ?errorMsg WHERE {
      ?melding nie:hasPart ${remoteDataObjectUriSparql} .
      GRAPH ?submissionGraph {
        ?job prov:generated ?melding .
        ?task
          dct:isPartOf ?job ;
          task:operation tasko:download ;
          adms:status ?oldStatus .
      }
      OPTIONAL { ?fileUri nie:dataSource ${remoteDataObjectUriSparql} . }
      OPTIONAL { ${remoteDataObjectUriSparql} ext:cacheError ?errorMsg . }
    }
    LIMIT 1`;
  const response = await query(taskQuery);
  let results = response.results.bindings;
  if (results.length > 0) results = results[0];
  else {
    const err = new Error(`Could not find task and other necessary related information for remote data object ${remoteDataObjectUri}.`);
    err.alreadyStoredError = true; //No need to store the error
    throw err;
  }
  return {
    downloadTaskUri: results.task.value,
    jobUri: results.job.value,
    oldStatus: results.oldStatus.value,
    submissionGraph: results.submissionGraph.value,
    fileUri: results.fileUri?.value,
    errorMsg: results.errorMsg?.value,
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
    case env.DOWNLOAD_STATUSES.ongoing:
      if (oldASSStatus === env.TASK_STATUSES.scheduled)
        return downloadStarted(submissionGraph, downloadTaskUri);
      break;
    case env.DOWNLOAD_STATUSES.success:
      if (
        oldASSStatus === env.TASK_STATUSES.scheduled ||
        oldASSStatus === env.TASK_STATUSES.busy
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
    case env.DOWNLOAD_STATUSES.failure:
      if (
        oldASSStatus === env.TASK_STATUSES.busy ||
        oldASSStatus === env.TASK_STATUSES.scheduled
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
  const err = new Error(`Download task ${downloadTaskUri} is being set to an unknown status ${newDLStatus} OR the transition to that status from ${oldASSStatus} is not allowed. This is related to job ${jobUri}.`);
  err.alreadyStoredError = true; //No need to store the error
  throw err;
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
    ${env.PREFIXES}
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
  const nowSparql = sparqlEscapeDateTime(new Date().toISOString());
  const downloadTaskUuid = uuid();
  const inputContainerUuid = uuid();
  const harvestingCollectionUuid = uuid();
  const downloadTaskQuery = `
    ${env.PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        asj:${downloadTaskUuid}
          a task:Task ;
          mu:uuid ${sparqlEscapeString(downloadTaskUuid)} ;
          adms:status js:scheduled ;
          dct:created ${nowSparql} ;
          dct:modified ${nowSparql} ;
          task:cogsOperation cogs:WebServiceLookup ;
          task:operation tasko:download ;
          dct:creator services:automatic-submission-service ;
          task:index "1" ;
          dct:isPartOf ${sparqlEscapeUri(jobUri)} ;
          task:inputContainer asj:${inputContainerUuid} .

        asj:${inputContainerUuid}
          a nfo:DataContainer ;
          mu:uuid ${sparqlEscapeString(inputContainerUuid)} ;
          task:hasHarvestingCollection asj:${harvestingCollectionUuid} .

        asj:${harvestingCollectionUuid}
          a hrvst:HarvestingCollection ;
          dct:creator services:automatic-submission-service ;
          dct:hasPart ${sparqlEscapeUri(remoteDataObjectUri)} .
      }
    }
  `;
  await update(downloadTaskQuery);

  const downloadTaskUri = env.JOB_PREFIX.concat(downloadTaskUuid);
  return downloadTaskUri;
}

async function downloadStarted(submissionGraph, downloadTaskUri) {
  const nowSparql = sparqlEscapeDateTime(new Date().toISOString());
  const downloadTaskUriSparql = sparqlEscapeUri(downloadTaskUri);
  const downloadTaskQuery = `
    ${env.PREFIXES}
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
          adms:status js:busy ;
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

async function downloadSuccess(
  submissionGraph,
  downloadTaskUri,
  logicalFileUri
) {
  const nowSparql = sparqlEscapeDateTime(new Date().toISOString());
  const resultContainerUuid = uuid();
  const downloadTaskUriSparql = sparqlEscapeUri(downloadTaskUri);
  const downloadTaskQuery = `
    ${env.PREFIXES}
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
          mu:uuid ${sparqlEscapeString(resultContainerUuid)} ;
          task:hasFile ${sparqlEscapeUri(logicalFileUri)} .
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

async function downloadFail(
  submissionGraph,
  downloadTaskUri,
  jobUri,
  logicalFileUri,
  errorMsg
) {
  const nowSparql = sparqlEscapeDateTime(new Date().toISOString());
  const downloadTaskUriSparql = sparqlEscapeUri(downloadTaskUri);
  const resultContainerUuid = uuid();
  const errorUuid = uuid();
  const fileTriples = logicalFileUri
    ? `
      asj:${resultContainerUuid}
        a nfo:DataContainer ;
        mu:uuid ${sparqlEscapeString(resultContainerUuid)} ;
        task:hasFile ${sparqlEscapeUri(logicalFileUri)} .`
    : '';
  const errorTriples = errorMsg
    ? `
      asj:${errorUuid}
        a oslc:Error ;
        oslc:message ${sparqlEscapeString(errorMsg)} .`
    : '';
  const linkResultContainerTriplePart = logicalFileUri
    ? `task:resultsContainer asj:${resultContainerUuid} ;`
    : '';
  const downloadTaskQuery = `
    ${env.PREFIXES}
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
          ${errorMsg ? `task:error asj:${errorUuid} ;` : ''}
          ${linkResultContainerTriplePart}
          dct:modified ${nowSparql} .
        ${fileTriples}
        ${errorTriples}
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

  //Also set the job to failure
  const jobUriSparql = sparqlEscapeUri(jobUri);
  const assJobQuery = `
    ${env.PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${jobUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
    INSERT {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${jobUriSparql}
          adms:status js:failed ;
          ${errorMsg ? `task:error asj:${errorUuid} ;` : ''}
          dct:modified ${nowSparql} ;
      }
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(submissionGraph)} {
        ${jobUriSparql}
          adms:status ?oldStatus ;
          dct:modified ?oldModified .
      }
    }
  `;
  await update(assJobQuery);
}
