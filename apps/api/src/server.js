(async () => {
  try {
    await import('./app.js');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();