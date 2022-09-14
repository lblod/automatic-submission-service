import * as env from './env.js';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { uuid, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';
import { downloadTaskCreate } from './downloadTaskManagement.js';
import { SparqlJsonParser } from 'sparqljson-parse';
const N3 = require('n3');
const { DataFactory } = N3;
const { quad } = DataFactory;

export async function startJob(submissionGraph, meldingUri) {
  try {
    const jobUuid = uuid();
    const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
    // Make a cogs:Job for the whole process
    // The prov:generated is strictly not necessary for the model, maybe nice to have
    const jobQuery = `
      ${env.PREFIXES}
      INSERT DATA {
        GRAPH ${sparqlEscapeUri(submissionGraph)} {
          asj:${jobUuid}
            a cogs:Job ;
            mu:uuid ${sparqlEscapeString(jobUuid)} ;
            dct:creator services:automatic-submission-service ;
            adms:status js:busy ;
            dct:created ${nowSparql} ;
            dct:modified ${nowSparql} ;
            task:cogsOperation cogs:TransformationProcess ;
            task:operation jobo:automaticSubmissionFlow ;
            prov:generated ${sparqlEscapeUri(meldingUri)} .
        }
      }
    `;
    await update(jobQuery);

    // Create a task for the automatic submission as the first step in the flow
    const submissionTaskUuid = uuid();
    const submissionTaskQuery = `
      ${env.PREFIXES}
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
            dct:isPartOf asj:${jobUuid} .
        }
      }
    `;
    await update(submissionTaskQuery);

    const jobUri = env.JOB_PREFIX.concat(jobUuid);
    const automaticSubmissionTaskUri = env.JOB_PREFIX.concat(submissionTaskUuid);
    return { jobUri, automaticSubmissionTaskUri, };
  }
  catch (e) {
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
export async function getSubmissionStatusRdfJS(submissionUri) {
  const response = await query(`
    ${env.PREFIXES}
    CONSTRUCT {
      ?job
        a cogs:Job ;
        adms:status ?jobStatus ;
        prov:generated ?submission ;
        task:error ?error.
      ${sparqlEscapeUri(submissionUri)}
        rdf:type meb:Submission ;
        adms:status ?submissionStatus .
      ?error
        a oslc:Error ;
        oslc:message ?message .
    }
    WHERE {
      ${sparqlEscapeUri(submissionUri)}
        rdf:type meb:Submission ;
        adms:status ?submissionStatus .
      ?job
        a cogs:Job ;
        dct:creator services:automatic-submission-service ;
        adms:status ?jobStatus ;
        task:cogsOperation cogs:TransformationProcess ;
        task:operation jobo:automaticSubmissionFlow ;
        prov:generated ?submission .
      OPTIONAL {
        ?job
          task:error ?error .
        ?error
          a oslc:Error ;
          oslc:message ?message .
      }
    }
  `);
  const sparqlJsonParser = new SparqlJsonParser();
  const parsedResults = sparqlJsonParser.parseJsonResults(response);
  const statusRdfJSTriples = parsedResults.map((binding) =>
    quad(binding.s, binding.p, binding.o)
  );
  return { statusRdfJSTriples, JobStatusContext, JobStatusFrame };
}

export async function automaticSubmissionTaskSuccess(submissionGraph, automaticSubmissionTaskUri, jobUri, remoteDataObjectUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(automaticSubmissionTaskUri);
  const resultContainerUuid = uuid();
  const harvestingCollectionUuid = uuid();
  const assTaskQuery = `
    ${env.PREFIXES}
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

export async function automaticSubmissionTaskFail(submissionGraph, automaticSubmissionTaskUri, jobUri, errorUri) {
  const nowSparql = sparqlEscapeDateTime((new Date()).toISOString());
  const automaticSubmissionTaskUriSparql = sparqlEscapeUri(automaticSubmissionTaskUri);
  const errorUriSparql = sparqlEscapeUri(errorUri);
  const assTaskQuery = `
    ${env.PREFIXES}
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
          dct:modified ${nowSparql} ;
          task:error ${errorUriSparql} .
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

