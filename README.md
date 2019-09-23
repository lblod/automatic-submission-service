# automatic-submission-service
Microservice providing an API for external parties to  process inzendingen voor toezicht.

# API
```
POST /melding # Content-Type: application/json
```
## Examples
### Inline context
```
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
```

### Mix inline and external context
```
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
```

## Adding the service to a mu.semte.ch project
Add the service to docker-compose.yml:

```
  submission:
    image: lblod/automatic-submission-service:0.3.2
```

Configure the dispatcher:
```
  match "/melding/*path" do
    Proxy.forward conn, path, "http://submission/melding"
  end
```

Make sure a submitter is set up in the database. 

```
@prefix muAccount: 	<http://mu.semte.ch/vocabularies/account/>
@prefix mu:   <http://mu.semte.ch/vocabularies/core/>
@prefix foaf: <http://xmlns.com/foaf/0.1/>
<http://example.com/vendor/d3c9e5e5-d50c-46c9-8f09-6af76712c277> a foaf:Agent;
                              muAccount:key "foobar";
                              muAccount:canActOnBehalfOf <http://data.lblod.info/id/bestuurseenheden/d64157ef-bde2-4814-b77a-2d43ce90d18a>;
                              foaf:name "vendor 1";
                              mu:uuid "d3c9e5e5-d50c-46c9-8f09-6af76712c277".
```

The service looks for this information in the graph ```http://mu.semte.ch/graphs/automatic-submission```. The organisation the agents acts on behalf of should have a uuid. 
