import {app, errorHandler} from 'mu';
import {verifyKeyAndOrganisation, storeSubmission, isSubmitted} from './support';
import bodyParser from 'body-parser';
import * as jsonld from 'jsonld';
import {enrichBody, extractInfoFromTriples, validateExtractedInfo} from "./jsonld-input";

app.use(errorHandler);
// support both jsonld and json content-type
app.use(bodyParser.json({type: 'application/ld+json'}));
app.use(bodyParser.json());

app.post('/melding', async function (req, res, next) {
  const validContentType = /application\/(ld\+)?json/.test(req.get('content-type'));
  if (!validContentType) {
    res.status(400).send({errors: [{title: "invalid content-type only application/json or application/ld+json are accepted"}]}).end();
  }
  try {
    if (req.body instanceof Array) {
      res.status(400).send({errors: [{title: "invalid json payload, expected an object but found array"}]}).end();
    } else {
      const body = req.body;
      console.log("Incoming request on /melding");
      console.debug(body);

      // enrich the body with minimum required json LD properties
      await enrichBody(body);
      // extracted the minimal required triples
      const triples = await jsonld.toRDF(body, {});

      const extracted = extractInfoFromTriples(triples);

      // check if the minimal required payload is available
      for (let prop in extracted) {
        if (!extracted[prop] && prop != 'authenticationConfiguration') { //TODO: if required vs optional fields grow, this will need to be better
          console.log(`WARNING: received an invalid JSON-LD payload! Could not extract ${prop}`);
          console.debug(body);
          res.status(400).send({
            errors: [{
              title: `Invalid JSON-LD payload: property ${prop.toLocaleUpperCase()} is missing or invalid.`,
              extractedTriples: triples
            }]
          }).end();
          return;
        }
      }

      // check if the extracted properties are valid
      const {isValid, errors} = validateExtractedInfo(extracted);
      if (!isValid) {
        res.status(400).send({errors}).end();
        return;
      }

      const { key, vendor, organisation, submittedResource, authenticationConfiguration } = extracted;

      // authenticate vendor
      const organisationID = await verifyKeyAndOrganisation(vendor, key, organisation);
      if (!organisationID) {
        res.status(401).send({
          errors: [{
            title: "Authentication failed, you do not have access to this resource. " +
              "If this should not be the case, please contact us at digitaalABB@vlaanderen.be for login credentials."
          }]
        }).end();
        return;
      }

      // check if the resource has already been submitted
      if (await isSubmitted(submittedResource)) {
        res.status(409).send({
          errors: [{
            title: `The given submittedResource <${submittedResource}> has already been submitted.`
          }]
        }).end();
        return;
      }

      // process the new auto-submission
      const submissionGraph = `http://mu.semte.ch/graphs/organizations/${organisationID}/LoketLB-toezichtGebruiker`;
      const fileGraph = "http://mu.semte.ch/graphs/public";
      const uri = await storeSubmission(triples, submissionGraph, fileGraph, authenticationConfiguration);
      res.status(201).send({uri}).end();
    }
  } catch (e) {
    console.log('WARNING: something went wrong while processing an auto-submission');
    console.error(e);
    res.status(400).send({
      errors: [{
        title: 'Something unexpected happened while processing the auto-submission request. ' +
          'If this keeps occurring, please contact us at digitaalABB@vlaanderen.be.'
      }]
    }).end();
  }
});
