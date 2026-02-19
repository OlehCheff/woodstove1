(function (global) {
  class PhysicsModel {
    constructor(options = {}) {
      this.constants = {
        woodDensityKgPerL: 0.22,
        lhvKwhPerKg: 4.0,
        baseBurnRateKgH: 0.75,
        maxBurnRateKgH: 3.8,
        burnPresetEfficiencyFactor: {
          'start-up': 0.92,
          low: 1.0,
          medium: 1.05,
          high: 0.96,
          overnight: 0.9
        },
        ...options.constants
      };
    }

    clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    // Input interface for physics core.
    buildInput(stoveParams = {}, mode = 'medium') {
      const primaryAirShutter = this.clamp(Number(stoveParams.primaryAirShutter ?? 45), 0, 100);
      const secondaryAir = this.clamp(Number(stoveParams.secondaryAir ?? 55), 0, 100);
      const airWashOpening = this.clamp(Number(stoveParams.airWashOpening ?? 8), 0, 30);
      const flameIntensity = this.clamp(Number(stoveParams.flameIntensity ?? 60), 0, 120);
      const fuelLoadVolumeL = this.clamp(Number(stoveParams.fuelLoadVolume ?? 32), 10, 80);

      const chamberWidthMm = Math.max(1, Number(stoveParams.chamberWidth ?? 500));
      const chamberDepthMm = Math.max(1, Number(stoveParams.chamberDepth ?? 500));
      const chamberHeightMm = Math.max(1, Number(stoveParams.chamberHeight ?? 450));
      const chamberVolumeM3 = (chamberWidthMm * chamberDepthMm * chamberHeightMm) / 1e9;

      const primaryHoleCount = Math.max(1, Number(stoveParams.primaryAirHoleCount ?? 4));
      const primaryHoleWidthMm = Math.max(1, Number(stoveParams.primaryAirHoleWidth ?? 50));
      const primaryHoleHeightMm = Math.max(1, Number(stoveParams.primaryAirHoleHeight ?? 35));
      const ovalAreaMm2 = Math.PI * (primaryHoleWidthMm / 2) * (primaryHoleHeightMm / 2);
      const primaryHoleAreaM2 = (ovalAreaMm2 * primaryHoleCount) / 1e6;

      return {
        mode,
        primaryAirShutter,
        secondaryAir,
        airWashOpening,
        flameIntensity,
        fuelLoadVolumeL,
        chamberVolumeM3,
        primaryHoleAreaM2
      };
    }

    evaluateWarnings(input) {
      const warnings = [];
      const primaryOpen = 100 - input.primaryAirShutter;

      if (primaryOpen <= 15 && input.secondaryAir <= 10) {
        warnings.push({ level: 'danger', text: '⚠️ Ризик диму/недогорання: первинна задвижка майже закрита і вторинне повітря майже нуль.' });
      } else if (primaryOpen <= 20 && input.secondaryAir <= 20) {
        warnings.push({ level: 'warning', text: 'ℹ️ Низький приплив повітря: можливе нестабільне горіння та утворення сажі.' });
      }

      if (primaryOpen >= 80 && input.secondaryAir >= 70 && input.airWashOpening >= 16 && input.flameIntensity >= 85) {
        warnings.push({ level: 'danger', text: '🔥 Надто гарячий режим, велика витрата палива.' });
      } else if (primaryOpen >= 70 && input.secondaryAir >= 60 && input.flameIntensity >= 75) {
        warnings.push({ level: 'warning', text: 'ℹ️ Режим ближчий до форсованого: контролюйте температуру корпусу.' });
      }

      if (warnings.length === 0) {
        warnings.push({ level: 'ok', text: '✅ Баланс повітря в межах робочого діапазону.' });
      }

      return warnings;
    }

    compute(input) {
      const primaryOpenNorm = this.clamp((100 - input.primaryAirShutter) / 100, 0.1, 0.95);
      const secondaryNorm = this.clamp(input.secondaryAir / 100, 0.1, 1.0);
      const airWashNorm = this.clamp(input.airWashOpening / 20, 0.1, 1.2);
      const flameNorm = this.clamp(input.flameIntensity / 100, 0.15, 1.3);

      const modeFactor = this.constants.burnPresetEfficiencyFactor[input.mode] || 1.0;
      const efficiency = this.clamp(
        (0.58 + secondaryNorm * 0.13 + airWashNorm * 0.08 - primaryOpenNorm * 0.07) * modeFactor,
        0.45,
        0.86
      );

      const burnRateKgPerHour = this.clamp(
        this.constants.baseBurnRateKgH + flameNorm * 1.9 + primaryOpenNorm * 0.8,
        0.7,
        this.constants.maxBurnRateKgH
      );

      const fuelMassKg = input.fuelLoadVolumeL * this.constants.woodDensityKgPerL;
      const heatOutputKw = burnRateKgPerHour * this.constants.lhvKwhPerKg * efficiency;
      const burnTimeHours = fuelMassKg / burnRateKgPerHour;

      const volumetricFlowM3H = this.clamp(
        (input.primaryHoleAreaM2 * 2600 * primaryOpenNorm) + (input.chamberVolumeM3 * 14 * secondaryNorm),
        2,
        120
      );

      const bodyTempC = this.clamp(90 + heatOutputKw * 28 + flameNorm * 85, 120, 520);
      const temperatureNorm = this.clamp((bodyTempC - 120) / 400, 0, 1);

      return {
        inputs: input,
        outputs: {
          airFlowM3H: volumetricFlowM3H,
          temperatureC: bodyTempC,
          efficiencyPct: efficiency * 100,
          heatOutputKw,
          burnTimeHours,
          combustion: {
            flameNorm,
            secondaryNorm,
            temperatureNorm,
            emissiveBase: 0.35 + flameNorm * 0.55,
            emissiveAmplitude: 0.15 + flameNorm * 0.25,
            emissiveSpeed: 3.0 + secondaryNorm * 4.0
          }
        },
        warnings: this.evaluateWarnings(input)
      };
    }
  }

  global.PhysicsModel = PhysicsModel;
})(window);
