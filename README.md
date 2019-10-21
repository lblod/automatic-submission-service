# automatic-submission-service
Microservice providing an API for external parties to automatically process a submission.

## Installation
Add the service to your `docker-compose.yml`:

```
  automatic-submission:
    image: lblod/automatic-submission-service
```

Configure the dispatcher by adding the following rule:
```
  match "/melding/*path" do
    Proxy.forward conn, path, "http://automatic-submission/melding"
  end
```

## Authorization and security
Submissions can only be submitted by known organizations using the API key they received. Organizations can only submit a publication on behalf of another organization if they have the permission to do so.

The service verifies the API key and permissions in the graph `http://mu.semte.ch/graphs/automatic-submission`. The organization the agents acts on behalf of should have a `mu:uuid`.

To allow an organization to submit a publication on behalf of another organization, add a resource similar to the example below in the `http://mu.semte.ch/graphs/automatic-submission` graph.


```
@prefix muAccount: 	<http://mu.semte.ch/vocabularies/account/>
@prefix mu:   <http://mu.semte.ch/vocabularies/core/>
@prefix foaf: <http://xmlns.com/foaf/0.1/>

<http://example.com/vendor/d3c9e5e5-d50c-46c9-8f09-6af76712c277> a foaf:Agent;
                              muAccount:key "my-super-secret-key";
                              muAccount:canActOnBehalfOf <http://data.lblod.info/id/bestuurseenheden/d64157ef-bde2-4814-b77a-2d43ce90d>;
                              foaf:name "Test vendor";
                              mu:uuid "d3c9e5e5-d50c-46c9-8f09-6af76712c277".
```


## API
```
POST /melding # Content-Type: application/json
```

See also: https://lblod.github.io/pages-vendors/#/docs/submission-api

### Examples
#### Inline context
```json
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

#### Mix inline and external context
```jaon
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

## Model
### Used prefixes
| Prefix       | URI                                                       |
|--------------|-----------------------------------------------------------|
| meb          | http://rdf.myexperiment.org/ontologies/base/              |
| dct          | http://purl.org/dc/terms/                                 |
| melding      | http://lblod.data.gift/vocabularies/automatische-melding/ |
| adms         | http://www.w3.org/ns/adms#                                |
| prov         | http://www.w3.org/ns/prov#                                |


### Automatic submission task
Upon receipt of the submission, the service will create an automatic submission task. The task describes the status and progress of the processing of an automatic submission

#### Class
`melding:AutomaticSubmissionTask`

#### Properties
| Name       | Predicate        | Range            | Definition                                                                                                                          |
|------------|------------------|------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| status     | `adms:status`    | `adms:Status`    | Status of the task, initially set to `<http://lblod.data.gift/automatische-melding-statuses/not-started>`                             |
| created    | `dct:created`    | `xsd:dateTime`   | Datetime of creation of the task                                                                                                    |
| modified   | `dct:modified`   | `xsd:dateTime`   | Datetime on which the task was modified                                                                                             |
| creator    | `dct:creator`    | `rdfs:Resource`   | Creator of the task, in this case the automatic-submission-service `<http://lblod.data.gift/services/automatic-submission-service>` |
| submission | `prov:generated` | `meb:Submission` | Submission generated by the task                                                                                                    |

### Automatic submission task statuses
The status of the task will be updated by other microservices to reflect the progress of the automatic submission processing. The following statuses are known:
* http://lblod.data.gift/automatische-melding-statuses/not-started
* http://lblod.data.gift/automatische-melding-statuses/importing
* http://lblod.data.gift/automatische-melding-statuses/ready-for-validation
* http://lblod.data.gift/automatische-melding-statuses/success
* http://lblod.data.gift/automatische-melding-statuses/failure

### Remote data object
Upon receipt of the submission, the service will create a remote data object for the submitted publication URL which will be downloaded by the [download-url-service](https://github.com/lblod/download-url-service). The model of the remote data object is described in the [README of the download-url-service](https://github.com/lblod/download-url-service).


## Related services
The following services are also involved in the automatic processing of a submission:
* [download-url-service](https://github.com/lblod/download-url-service)
* [import-submission-service](https://github.com/lblod/import-submission-service)
