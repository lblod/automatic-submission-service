import { app } from 'mu';
app.post('/melding', async function(req, res, next) {
  try {
    res.send({success: true, message: "Hello"});
  }
  catch(e) {
    console.error(e);
    return next(new Error(e.message));
  }
});
