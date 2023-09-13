# automatic-submission-service

Microservice providing an API for external parties to automatically process a
submission.

## Getting started

### Add the service to a stack

Add the service to your `docker-compose.yml`:

```yaml
automatic-submission:
  image: lblod/automatic-submission-service:1.3.0
```

Configure the dispatcher by adding the following rule:

```elixir
match "/melding/*path" do
  Proxy.forward conn, path, "http://automatic-submission/melding"
end
```

## How-to guides

### Authorize an agent to submit on behalf of an organization

To allow an organization to submit a publication on behalf of another
organization, add a resource similar to the example below:

```sparql
PREFIX muAccount: 	<http://mu.semte.ch/vocabularies/account/>
PREFIX mu:   <http://mu.semte.ch/vocabularies/core/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

INSERT DATA {
  GRAPH <http://mu.semte.ch/graphs/automatic-submission> {
    <http://example.com/vendor/d3c9e5e5-d50c-46c9-8f09-6af76712c277>
      a foaf:Agent, ext:Vendor ;
      muAccount:key "my-super-secret-key";
      muAccount:canActOnBehalfOf
        <http://data.lblod.info/id/bestuurseenheden/d64157ef-bde2-4814-b77a-2d43ce90d>;
      foaf:name "Test vendor";
      mu:uuid "d3c9e5e5-d50c-46c9-8f09-6af76712c277".
  }
}
```

## Reference

### API

To register a new resource as a submission:

```
POST /melding
Content-Type: application/json # or application/ld+json
```

Use the JSON-LD context as described in [Meldingsplicht
API](https://lblod.github.io/pages-vendors/#/docs/submission-api) for how to
structure the body.

**Note: refer to the documentation on the [Vendor SPARQL
API](https://lblod.github.io/pages-vendors/#/docs/vendor-sparql-api). That is
the supported way to get status information. Alternatively, you could also use
the following.**

To fetch the status of the processing of the resource:

```
POST /status
Content-Type: application/json # or application/ld+json
```

Getting the status can be done in the same context as registering a submission,
but supply a submission URI instead. Look at some examples below.

### Succesful response

When the submission has been successfully sent in, you get the following response:

```
201 Created
{
  "uri": "http://data.lblod.info/submissions/e5725210-527b-11ee-bd48-c53e584duaa8",
  "submission": "http://data.lblod.info/submissions/e5725210-527b-11ee-bd48-c53e584duaa8",
  "job": "http://data.lblod.info/id/automatic-submission-job/e58a4fd0-522b-11ee-bd48-c56e584deaa8"
}
```

The `uri` and `submission` properties are identical. The `uri` is there for
backwards compatibility with an old version of this service. The `submission`
and `job` properties contain the URIs for the newly created submission and the
associated processing job respectively. These can be used in the [Vendor SPARQL
API](https://lblod.github.io/pages-vendors/#/docs/vendor-sparql-api).

### Error responses

The following responses can be returned by this service. Error messages are
displayed next to the HTTP response code here, but in the actual response, the
message is inside a structure like: `{"errors": [{"title": "...message..."}]}`.

* `400 Content-Type not valid, only application/json or application/ld+json are
  accepted`: when the content type is not correct. This service only accepts
  JSON and JSON-LD content.
* `400 Invalid JSON payload, expected an object but found array.`: when the
  content structure is incorrect. Use properly formatted JSON.
* `400 Invalid JSON-LD payload: property "XXX" is missing or invalid.`:
  property `XXX` cound not be found in the request, but is needed.
* `400 Some given properties are invalid: XXX`: `XXX` is a list of error
  messages describing the problem with the given properties.
* `409 The given submittedResource <URI> has already been submitted.`: when the
  service can already find a submission for this URI. If you really need to
  resend this submission, the previous submission has to be deleted first,
  which is only possible if it is in "concept" status. The submission can then
  be resent.
* `400 The authentication (or part of it) for this request is missing. Make
  sure to supply publisher (with vendor URI and key) and organization
  information to the request.`: you need to supply at least `organization:
  "<URI>", publisher: { uri: "<URI>", key: "XXX" }` with the correct
  credentials to be able to post a submission.
* `401 Authentication failed, vendor does not have access to the organization
  or does not exist. If this should not be the case, please contact us at
  digitaalABB@vlaanderen.be for login credentials.`: this is when the given
  credentials are incorrect or these credentials do not allow for sending a
  submission in this organisation.

#### Examples

##### Submission with inline context

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
    },
  },
  "organization": {
    "uri": "http://data.lblod.info/id/bestuurseenheden/2498239",
    "@type": "besluit:Bestuurseenheid"
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
  "href": "http://raadpleegomgeving.tielt-winge.be/floppie",
  "@id": "http://data.lblod.info/submissions/4298239",
  "@type": "meb:Submission"
}
```

##### Submission with mix of inline and external context

```json
{
  "@context": [
    "https://lblod.data.gift/contexts/automatische-melding/v1/context.json",
    {
      "ext": "http://mu.semte.ch/vocabularies/ext/",
      "testedAndApprovedBy": { "@type": "@id", "@id": "ext:testedAndApprovedBy" }
    }
  ],
  "testedAndApprovedBy": "http://data.lblod.info/a/custom/tester",
  "organization": {
    "uri": "http://data.lblod.info/id/bestuurseenheden/2498239",
    "@type": "besluit:Bestuurseenheid"
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
  "href": "http://raadpleegomgeving.tielt-winge.be/floppie",
  "@id": "http://data.lblod.info/submissions/4298239",
  "@type": "meb:Submission"
}
```

#### Submission with minimal body

Due to the implementation of this service, the context and some other
properties are always attached to the JSON(-LD) body before processing. This
means you could get away with a very minimal body such as the following:

```json
{
  "href": "http://raadpleegomgeving.tielt-winge.be/floppie",
  "organization": "http://data.lblod.info/id/bestuurseenheden/2498239",
  "publisher": {
    "uri": "http://data.lblod.info/vendors/cipal-schaubroeck",
    "key": "AE86-GT86",
  },
  "submittedResource": "http://data.tielt-winge.be/besluiten/2398230"
}
```

#### Status request with minimal body *(not recommended)*

The same as the previous example applies when it comes to asking for the status
of the submission:

```json
{
  "organization": "http://data.lblod.info/id/bestuurseenheden/2498239",
  "publisher": {
    "uri": "http://data.lblod.info/vendors/cipal-schaubroeck",
    "key": "AE86-GT86",
  },
  "submission": "http://data.lblod.info/submissions/4298239"
}
```

### Authorization and security

Submissions can only be submitted by known organizations using the API key they
received. Organizations can only submit a publication on behalf of another
organization if they have the permission to do so.

The service verifies the API key and permissions in the graph
`http://mu.semte.ch/graphs/automatic-submission`. The organization the agents
acts on behalf of should have a `mu:uuid`.

A second layer of authentication can be configured

#### Basic auth

```json
{
  "href": "http://raadpleegomgeving.tielt-winge.be/90283409812734",
  "authentication": {
    "configuration": {
      "scheme": "basic"
    },
    "credentials": {
      "username": "foo",
      "password": "bar"
    }
  },
  "organization": "http://data.lblod.info/id/bestuurseenheden/2498239",
  "publisher": {
    "uri": "http://data.lblod.info/vendors/cipal-schaubroeck",
    "key": "AE86-GT86"
  },
  "status": "http://lblod.data.gift/concepts/f6330856-e261-430f-b949-8e510d20d0ff",
  "submittedResource": "http://data.tielt-winge.be/besluiten/2398230"
}
```

#### Oath2

```json
{
  "href": "http://raadpleegomgeving.tielt-winge.be/90283409812734",
  "authentication":{
    "configuration": {
      "scheme": "oauth2",
      "flow": "client",
      "resource": "private",
      "token": "https://example.com/oauth2/access/tokenserver"
    },
    "credentials": {
      "clientId": "foo",
      "clientSecret": "bar"
    }
  },
  "organization": "http://data.lblod.info/id/bestuurseenheden/2498239",
  "publisher": {
    "uri": "http://data.lblod.info/vendors/cipal-schaubroeck",
    "key": "AE86-GT86"
  },
  "status": "http://lblod.data.gift/concepts/f6330856-e261-430f-b949-8e510d20d0ff",
  "submittedResource": "http://data.tielt-winge.be/besluiten/2398230"
}
```

### Model

#### Automatic submission task

Upon receipt of the submission, the service will create an automatic submission
job for the whole flow and a related task for the work in this services.

##### Class

`task:Task`

##### Properties

The model is specified in the [README of the
job-controller-service](https://github.com/lblod/job-controller-service#task).

#### Automatic submission task statuses

Once the automatic submission process starts, the status of the automatic
submission task is updated to
`http://redpencil.data.gift/id/concept/JobStatus/busy`.

On successful completion, the status of the automatic submission task is
updated to `http://redpencil.data.gift/id/concept/JobStatus/success`. The
resultsContainer of the task wil contain a harvesting collection that refers to
the remote data object for the HTML page containing the RDFa for the
submission.

On failure, the status is updated to
`http://redpencil.data.gift/id/concept/JobStatus/failed`. If possible, an error
is written to the database and the error is linked to this failed task.

#### Download-url-service task

In addition to a Job and Task for the automatic submission service, this
service will also manage the download process from the download-url-service.
The download-url-service is a reusable component that could not (yet) be
adapted to integrate with the jobs-controller-service's model, so that service
needs to be managed here too. To do this, some rules in the delta-notifier are
needed and there is a extra API entry specifically for managing download
statuses. This process will also create tasks as describe by the model
referenced above. The jobs-controller-service needs to pick up after the
download-url-service's task has been successful.

#### Submission

Submission to be processed automatically. The properties of the submission are
retrieved from the JSON-LD body of the request.

##### Class

`meb:Submission`

##### Properties

For a full list of properties of a submission, we refer to the [automatic
submission
documentation](https://lblod.github.io/pages-vendors/#/docs/submission-annotations).
In addition to the properties, the automatic submission services enriches the
submission with the following properties:

| Name              | Predicate     | Range                  | Definition                                     |
|-------------------|---------------|------------------------|------------------------------------------------|
| part              | `nie:hasPart` | `nfo:RemoteDataObject` | Submission publication URL to download         |
| submittedResource | `dct:subject` | `foaf:Document`        | Document that is the subject of the submission |

#### Remote data object

Upon receipt of the submission, the service will create a remote data object
for the submitted publication URL which will be downloaded by the
[download-url-service](https://github.com/lblod/download-url-service).

##### Class

`nfo:RemoteDataObject`

##### Properties

The model of the remote data object is described in the [README of the
download-url-service](https://github.com/lblod/download-url-service).

#### Submitted resource

Document that is the subject of the submission. The properties of the submitted
resource are harvested from the publication URL by the
[import-submission-service](https://github.com/lblod/import-submission-service),
[enrich-submission-service](https://github.com/lblod/enrich-submission-service)
and
[validate-submission-service](https://github.com/lblod/validate-submission-service)
at a later stage in the automatic submission process.

##### Class

`foaf:Document` (and `ext:SubmissionDocument`)

##### Properties

For a full list of properties of a submitted resource, we refer to the
[automatic submission
documentation](https://lblod.github.io/pages-vendors/#/docs/submission-annotations).

## Related services

The following services are also involved in the automatic processing of a
submission:

* [download-url-service](https://github.com/lblod/download-url-service)
* [import-submission-service](https://github.com/lblod/import-submission-service)
* [enrich-submission-service](https://github.com/lblod/enrich-submission-service)
* [validate-submission-service](https://github.com/lblod/validate-submission-service)
* [toezicht-flattened-form-data-generator](https://github.com/lblod/toezicht-flattened-form-data-generator)
