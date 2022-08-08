import * as env from './env.js';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { uuid, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';
import { downloadTaskCreate } from './downloadTaskManagement.js';

export async function startJob(submissionGraph, meldingUri) {
  try {
    console.log("CORRECT START JOB BINNEN");
    const jobUuid = uuid();
    const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
    // Make a cogs:Job for the whole process
    // The prov:generated is strictly not necessary for the model, maybe nice to have
    const jobQuery = `
      ${env.getPrefixes(["xsd", "asj", "cogs", "mu", "dct", "task", "prov", "adms", "js", "services"])}
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
    console.log("JOB OPGESTART");

    // Create a task for the automatic submission as the first step in the flow
    const submissionTaskUuid = uuid();
    const submissionTaskQuery = `
      ${env.getPrefixes(["xsd", "asj", "cogs", "mu", "dct", "task", "prov", "adms", "js", "services"])}
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
    console.log("TASK OPGESTART");

    const jobUri = env.JOB_PREFIX.concat(jobUuid);
    const automaticSubmissionTaskUri = env.JOB_PREFIX.concat(submissionTaskUuid);
    return { jobUri, automaticSubmissionTaskUri, };
  }
  catch (e) {
    console.error(e);
  }
}

export async function automaticSubmissionTaskSuccess(submissionGraph, automaticSubmissionTaskUri, jobUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(automaticSubmissionTaskUri);
  const resultContainerUuid = uuid();
  const assTaskQuery = `
    ${env.getPrefixes(["xsd", "asj", "mu", "dct", "task", "adms", "js", "nfo"])}
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

  return downloadTaskCreate(submissionGraph, jobUri);
}

export async function automaticSubmissionTaskFail(submissionGraph, automaticSubmissionTaskUri, jobUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(automaticSubmissionTaskUri);
  const assTaskQuery = `
    ${env.getPrefixes(["xsd", "asj", "mu", "dct", "task", "adms", "js", "nfo"])}
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

  //Also set the job to failure
  const jobUriSparql = sparqlEscapeUri(jobUri);
  const assJobQuery = `
    ${env.getPrefixes(["xsd", "asj", "mu", "dct", "task", "adms", "js", "nfo"])}
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
