const context = {
  "besluit": "http://data.vlaanderen.be/ns/besluit#",
  "prov": "http://www.w3.org/ns/prov#",
  "dct": "http://purl.org/dc/terms/",
  "muAccount": "http://mu.semte.ch/vocabularies/account/",
  "meb": "http://rdf.myexperiment.org/ontologies/base/",
  "foaf": "http://xmlns.com/foaf/0.1/",
  "pav": "http://purl.org/pav/",
  "adms": "http://www.w3.org/ns/adms#",
  "organization": {
    "@id": "pav:createdBy",
    "@type": "@id"
  },
  "href": { "@type": "@id", "@id": "prov:atLocation"},
  "submittedResource": { "@type": "@id", "@id": "dct:subject" },
  "key": "muAccount:key",
  "publisher": "pav:providedBy",
  "uri": {
    "@type": "@id",
    "@id": "@id"
  },
  "status": {
    "@type": "@id",
    "@id": "adms:status"
  }
};

/**
 * returns the default jsonld context
 * NOTE: uses a hardcoded context for the moment, probably should retrieve it once available
 */
async function getContext() {
  return context;
}

export { getContext };
