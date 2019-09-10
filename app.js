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
