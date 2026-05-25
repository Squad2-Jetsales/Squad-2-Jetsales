const service = require('./webhook.service');

exports.handleEvolution = async (req, res) => {
  if (!service.isSecretValid(req)) {
    return res.status(401).json({ error: 'Webhook secret invalido', code: 'UNAUTHORIZED' });
  }

  try {
    const result = await service.handleEvolutionWebhook(req.body || {}, req.params.eventSlug);

    if (result.event) {
      console.info(
        `[evolution-webhook] event=${result.event} handled=${Boolean(result.handled)} persisted=${result.persisted || 0}`
      );
    }

    return res.status(200).json({
      ok: true,
      event: result.event,
      handled: Boolean(result.handled),
      persisted: result.persisted || 0,
    });
  } catch (err) {
    console.error(`[evolution-webhook] falha interna: ${err.message}`);
    return res.status(200).json({ ok: true, handled: false });
  }
};
