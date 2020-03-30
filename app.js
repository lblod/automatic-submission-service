import { uuid, app, errorHandler } from 'mu';
import { enrichBody, validateBody, verifyKeyAndOrganisation, storeSubmission } from './support';
import bodyParser from 'body-parser';
import * as jsonld from 'jsonld';
app.use(errorHandler);
// support both jsonld and json content-type
app.use(bodyParser.json({ type: 'application/ld+json'}));
app.use(bodyParser.json());

app.post('/melding', async function(req, res, next ) {
  const validContentType = /application\/(ld\+)?json/.test(req.get('content-type'));
  if (!validContentType) {
    res.status(400).send({errors: [{title: "invalid content-type only application/json or application/ld+json are accepted"}]}).end();
  }
  try {
    if (req.body instanceof Array) {
      res.status(400).send({errors: [{title: "invalid json payload, expected an object but found array"}]}).end();
    }
    else {
      const body = req.body;
      await enrichBody(body);
      const { isValid, errors } = validateBody(body);
      if (!isValid) {
        res.status(400).send({errors}).end();
      }
      const triples = await jsonld.toRDF(body, {});
      const keyTriple = triples.find((triple) => triple.predicate.value === "http://mu.semte.ch/vocabularies/account/key");
      const vendorTriple = triples.find((triple) => triple.predicate.value === 'http://purl.org/pav/providedBy');
      const organisationTriple = triples.find((triple) => triple.predicate.value === "http://purl.org/pav/createdBy");
      if (! keyTriple || ! vendorTriple| ! organisationTriple) {
        console.log("WARNING: received an invalid json payload! Could not extract keyTriple, vendorTriple or organisationTriple");
        console.debug(body);
        res.status(400).send({errors: [{ title: "invalid json payload: missing key, vendor or organisation", extractedTriples: triples}]}).end();
        return;
      }
      const key = keyTriple.object.value;
      const vendor = vendorTriple.object.value;
      const organisation = organisationTriple.object.value;
      const organisationID = await verifyKeyAndOrganisation(vendor, key, organisation);
      if (!organisationID) {
        res.status(401).send({errors: [{title: "Invalid key"}]}).end();
      }
      else {
        const submissionGraph = `http://mu.semte.ch/graphs/organizations/${organisationID}/LoketLB-toezichtGebruiker`;
        const fileGraph = "http://mu.semte.ch/graphs/public";
        const uri = await storeSubmission(triples, submissionGraph, fileGraph);
        res.status(201).send({uri}).end();
      }
    }
  }
  catch(e) {
    console.error(e);
    next(new Error(e.message));
  }
});
