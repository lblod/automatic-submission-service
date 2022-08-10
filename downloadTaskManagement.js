import * as env from './env.js';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { uuid, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';

export async function getTaskInfoFromRemoteDataObject(remoteDataObjectUri) {
  const remoteDataObjectUriSparql = sparqlEscapeUri(remoteDataObjectUri);
  //TODO this query is rather fragile, relying on the links between melding, job and task via non-documented properties, made by the download-url-service
  const taskQuery = `
    ${env.getPrefixes(['nie', 'prov', 'dct', 'task', 'adms', 'tasko'])}
    SELECT ?task ?job ?oldStatus ?submissionGraph ?fileUri WHERE {
      ?melding nie:hasPart ${remoteDataObjectUriSparql} .
      GRAPH ?submissionGraph {
        ?job prov:generated ?melding .
        ?task dct:isPartOf ?job ;
              task:operation cogs:WebServiceLookup ;
              adms:status ?oldStatus .
      }
      OPTIONAL { ?fileUri nie:dataSource ${remoteDataObjectUriSparql} . }
    }
  `;
  const response = await query(taskQuery);
  let results = response.results.bindings;
  if (results.length > 0) results = results[0];
  else
    throw new Error(`Could not find task and other necessary related information for remote data object ${remoteDataObjectUri}.`);
  return {
    downloadTaskUri: results.task.value,
    jobUri: results.job.value,
    oldStatus: results.oldStatus.value,
    submissionGraph: results.submissionGraph.value,
    fileUri: results.fileUri?.value,
  };
}

export async function downloadTaskUpdate(submissionGraph, downloadTaskUri, jobUri, oldASSStatus, newDLStatus, logicalFileUri) {
  switch (newDLStatus) {
    case env.DOWNLOAD_STATUSES.ongoing:
      if (oldASSStatus === env.TASK_STATUSES.scheduled)
        return downloadStarted(submissionGraph, downloadTaskUri);
      break;
    case env.DOWNLOAD_STATUSES.success:
      if (oldASSStatus === env.TASK_STATUSES.scheduled || oldASSStatus === env.TASK_STATUSES.busy)
        return downloadSuccess(submissionGraph, downloadTaskUri, logicalFileUri);
      break;
    case env.DOWNLOAD_STATUSES.failure:
      if (oldASSStatus === env.TASK_STATUSES.busy || oldASSStatus === scheduled)
        return downloadFail(submissionGraph, downloadTaskUri, jobUri);
      break;
  }
  throw new Error(`Download task ${downloadTaskUri} is being set to an unknown status ${newDLStatus} OR the transition to that status from ${oldASSStatus} is not allowed. This is related to job ${jobUri}.`);
}

export async function downloadTaskCreate(submissionGraph, jobUri, remoteDataObjectUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
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
          task:operation cogs:WebServiceLookup ;
          dct:creator services:automatic-submission-service ;
          task:index "1" ;
          dct:isPartOf ${sparqlEscapeUri(jobUri)} ;
          task:inputContainer asj:${inputContainerUuid} .

        asj:j${inputContainerUuid}
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

export async function downloadStarted(submissionGraph, downloadTaskUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
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

export async function downloadSuccess(submissionGraph, downloadTaskUri, logicalFileUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
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

export async function downloadFail(submissionGraph, downloadTaskUri, jobUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
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
          dct:modified ${nowSparql} .
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

