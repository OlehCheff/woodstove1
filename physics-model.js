(function () {
  const MODE_COEFFICIENTS = {
    'start-up': { efficiencyBias: -4, powerFactor: 1.05, burnFactor: 0.72 },
    'low': { efficiencyBias: 2, powerFactor: 0.58, burnFactor: 1.38 },
    'medium': { efficiencyBias: 4, powerFactor: 0.82, burnFactor: 1.0 },
    'high': { efficiencyBias: -2, powerFactor: 1.18, burnFactor: 0.74 },
    'overnight': { efficiencyBias: -6, powerFactor: 0.42, burnFactor: 1.75 }
  };

  function round(value, digits) {
    const base = Math.pow(10, digits);
    return Math.round(value * base) / base;
  }

  function safeMode(modeName) {
    return MODE_COEFFICIENTS[modeName] ? modeName : 'medium';
  }

  const PhysicsModel = {
    evaluate(config) {
      const mode = safeMode(config?.operation?.mode);
      const coeff = MODE_COEFFICIENTS[mode];

      const width = Number(config?.dimensions?.widthCm || 70);
      const depth = Number(config?.dimensions?.depthCm || 55);
      const height = Number(config?.dimensions?.heightCm || 95);
      const steelMm = Number(config?.materials?.steelThicknessMm || 5);

      const primaryAirPct = Number(config?.primaryAir?.openPct || 50);
      const secondaryAirPct = Number(config?.operation?.secondaryAirPct || 55);
      const airWashGapCm = Number(config?.airWash?.gapCm || 1.4);
      const flameIntensity = Number(config?.operation?.flameIntensity || 0.6);

      const chamberVolumeM3 = (width * depth * height) / 1_000_000;
      const airMix = (primaryAirPct * 0.55 + secondaryAirPct * 0.45) / 100;

      const baseEfficiency = 66 + (secondaryAirPct - primaryAirPct) * 0.08 + airWashGapCm * 1.6;
      const efficiencyPct = Math.max(52, Math.min(84, baseEfficiency + coeff.efficiencyBias));

      const geometryFactor = Math.max(0.75, Math.min(1.25, chamberVolumeM3 / 0.35));
      const heatOutputKw = Math.max(
        2.2,
        Math.min(15.5, (3.6 + flameIntensity * 8.8) * airMix * coeff.powerFactor * geometryFactor)
      );

      const burnTimeHours = Math.max(
        2.2,
        Math.min(14.5, (10.2 / Math.max(heatOutputKw, 0.1)) * coeff.burnFactor * (1 + steelMm * 0.03))
      );

      const warnings = [];

      if (primaryAirPct < 22 && secondaryAirPct < 30) {
        warnings.push({ level: 'warn', code: 'SMOKE_RISK', message: 'Ризик димлення: замало первинного і вторинного повітря.' });
      }

      if (heatOutputKw > 10.5 && steelMm <= 4) {
        warnings.push({ level: 'danger', code: 'OVERHEAT_RISK', message: 'Ймовірний перегрів корпусу: висока потужність при тонкій сталі.' });
      }

      if (efficiencyPct < 62) {
        warnings.push({ level: 'warn', code: 'INEFFICIENT_MODE', message: 'Неефективний режим: низький орієнтовний КПД.' });
      }

      if (airWashGapCm < 0.9 && flameIntensity > 0.75) {
        warnings.push({ level: 'warn', code: 'DIRTY_GLASS', message: 'Ймовірне закопчення скла: вузький air wash при інтенсивному полум’ї.' });
      }

      if (mode === 'start-up' && burnTimeHours > 6) {
        warnings.push({ level: 'info', code: 'STARTUP_LONG', message: 'Для start-up режиму час горіння нетипово великий — перевірте подачу повітря.' });
      }

      return {
        mode,
        metrics: {
          efficiencyPct: round(efficiencyPct, 1),
          heatOutputKw: round(heatOutputKw, 2),
          burnTimeHours: round(burnTimeHours, 1)
        },
        warnings
      };
    }
  };

  window.PhysicsModel = PhysicsModel;
})();
