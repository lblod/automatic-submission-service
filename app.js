import { app } from 'mu';
import bodyParser from 'body-parser';
import * as jsonld from 'jsonld';

// To make it easier for vendor, accept-type: application/json
app.use(bodyParser.json());

app.post('/melding', async function(req, res, next ) {
  try {
    let ttl = await jsonld.toRDF(req.body, {format: 'application/n-quads'});
    res.writeHead(200, {'Content-Type': 'text/turtle; charset=UTF-8'});
    res.write(ttl);
    res.end();
  }
  catch(e) {
    console.error(e);
    next(new Error(e.message));
  }
});


/********************************************** Example call: inline context  **********************************************

{
  "@context": {
    "besluit": "http://data.vlaanderen.be/ns/besluit#",
    "prov": "http://www.w3.org/ns/prov#",
    "dct": "http://purl.org/dc/terms/",
    "muAccount": "http://mu.semte.ch/vocabularies/account/",
    "meb": "http://rdf.myexperiment.org/ontologies/base/",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "pav": "http://purl.org/pav/",

    "organization": {
      "@id": "pav:createdBy",
      "@type": "@id"
    },
    "url": { "@type": "@id", "@id": "prov:atLocation"},
    "submittedResource": { "@type": "@id", "@id": "dct:subject" },
    "key": "muAccount:key",
    "publisher": "pav:providedBy",
    "uri": {
      "@type": "@id",
      "@id": "@id"
    }
  },
  "organization": {
    "uri": "http://data.lblod.info/id/bestuurseenheden/2498239",
    "@type": "besluit:BestuursEeenheid"
  },
  "publisher": {
    "uri": "http://data.lblod.info/vendors/cipal-schaubroeck",
    "key": "AE86-GT86",
    "@type": "foaf:Agent"
  },
  "submittedResource": {
    "uri": "http://data.tielt-winge.be/besluiten/2398230"
  },
  "status": {
    "uri": "http://data.lblod.info/document-statuses/concept"
  },
  "url": "http://raadpleegomgeving.tielt-winge.be/floppie",
  "@id": "http://data.lblod.info/submissions/4298239",
  "@type": "meb:Submission"
}

********************************************** End Example call: inline context  **********************************************/

/********************************************** Example call: external and inline context  **********************************************

{
  "@context": [
  "https://lblod.data.gift/contexts/automatische-melding/v1/context.json",
  {
    "ext": "http://mu.semte.ch/vocabularies/ext/",
    "testedAndApprovedBy": { "@type": "@id", "@id": "ext:testedAndApprovedBy" }
  }],
  "testedAndApprovedBy": "http://data.lblod.info/a/custom/tester",
  "organization": {
    "uri": "http://data.lblod.info/id/bestuurseenheden/2498239",
    "@type": "besluit:BestuursEeenheid"
  },
  "publisher": {
    "uri": "http://data.lblod.info/vendors/cipal-schaubroeck",
    "key": "AE86-GT86",
    "@type": "foaf:Agent"
  },
  "submittedResource": {
    "uri": "http://data.tielt-winge.be/besluiten/2398230"
  },
  "status": {
    "uri": "http://data.lblod.info/document-statuses/concept"
  },
  "url": "http://raadpleegomgeving.tielt-winge.be/floppie",
  "@id": "http://data.lblod.info/submissions/4298239",
  "@type": "meb:Submission"
}

********************************************** End Example call: external and inline  context  **********************************************/
