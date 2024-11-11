//-------------------------------------------------------------------------------------------------------------------
// ioBroker JavaScript:
// Berechne aktuellen Tagesverbrauch in kWh, Autarkiegrad, Eigenverbrauch und generierte Einnahmen
// von Alpha-ESS Systemen auf Basis von Modbuswerten.
//
// Nachts um 0:00 Uhr werden die Tageswerte wieder auf 0 zurück gesetzt (kann deaktiviert werden, s.u.)
// 
// Die State Namen entsprechen den Modbus Definitionen von hier:
// https://github.com/ioBroker/modbus-templates/blob/main/PV-Wechselrichter/Alpha-ESS/holding_register.txt
// Damit das Script unverändert funktioniert, muss der Modbus Adapter Instanz 0 sein und der Haken bei
// "Adresse nicht in ID aufnehmen" muss gesetzt sein.
//
// 23.02.2024  V1.0.0 (Gaspode) Erste Version
// 25.02.2024  V1.0.1 (Gaspode) Ignoriere Tagessumme, wenn rückläufig
// 26.02.2024  V1.0.2 (Gaspode) Kleine Korrektur für rückläufige Tagessumme bei Script-Neustart
// 29.02.2024  V2.0.0 (Gaspode) Erlaube Unterdrückung der Rücksetzung um Mitternacht
//                              Berechne zusätzlich den Direktverbrauch der erzeugten PV Energie
//                              Diverse interne Anpassungen
//                              ACHTUNG: Der State Name für den Gesamtverbrauch wurde umbenannt von 
//                                       HoseLoad zu Consumption_House" 
// 24.09.2024  V2.1.0 (Gaspode) Zusätzliche Tageswerte und Gesamtwerte für Eigenverbrauch, Autarkiegrad und Einnahmen.
//                              Danke an reini72 von Storion4you.de 
//                              VORSICHT: Die State Namen haben sich alle geändert, da jetzt eine Unterteilung in
//                                        Unterordner stattfindet!
// 30.09.2024  V2.1.1 (Gaspode) Die Werte für Consumption_House und Consumption_DirectPV werden jetzt um Mitternacht wieder
//                              korrekt zurück gesetzt.
// 01.10.2024  V2.1.2 (Gaspode) Prüfe beim Start, ob die benötigten Modbus States vorhanden sind
// 04.11.2024  V2.1.3 (Gaspode) Setze ACK auf true beim Schreiben von States
// 11.11.2024  V2.1.4 (Gaspode) Korrektur der Berechnung von total.Self_sufficiency
//-------------------------------------------------------------------------------------------------------------------


// Setze auf false, wenn um Mitternacht nicht zurückgesetzt werden soll, sondern weitergezählt werden soll
const resetAtMidnight = true;

// Preise für Einnahmenberechnung
const incomeUnit = '€';
const priceBuy   = 0.4;
const priceSell  = 0.0803;

// Root Ordner im ioBroker Objektbaum:
const modbusRoot      = 'modbus.0.holdingRegisters.';
const resultRootx      = '0_userdata.0.PV.';
const midnightRoot    = resultRootx + 'midnight.';
const resultRootToday = resultRootx + 'today.';
const resultRootTotal = resultRootx + 'total.';

// Namen der Modbus States:
const gridConsumptionStateName  = '_Total_energy_consume_from_grid_(Grid_Meter)';
const batteryDischargeStateName = '_Battery_discharge_energy';
const batteryChargeStateName    = '_Battery_charge_energy';
const pvGenerationStateName     = '_Total_PV_Energy';
const gridFeedInStateName       = '_Total_energyfeed_to_grid_(Grid_Meter)';

// Namen der Ergebnis States:
const houseConsumptionStateName     = 'Consumption_House'; // Hausverbrauch heute [kWh]
const directPVConsumptionStateName  = 'Consumption_DirectPV'; // PV Direktverbrauch heute [kWh]
const incomeTodayStateName          = 'Income'; // Einnahmen heute [€]
const selfSufficiencyTodayStateName = 'Self_sufficiency'; // Autarkiegrad heute [%]
const selfConsumptionTodayStateName = 'Self_consumption'; // Anteil_Eigenverbrauch heute [%]
const incomeTotalStateName          = 'Income'; // Einnahmen gesamt [€]
const selfSufficiencyTotalStateName = 'Self_sufficiency'; // Autarkiegrad gesamt [%]
const selfConsumptionTotalStateName = 'Self_consumption'; // Anteil_Eigenverbrauch gesamt [%]

// Variablen für aktuelle Werte
let gridConsumption  = 0;
let batteryDischarge = 0;
let batteryCharge    = 0;
let pvGeneration     = 0;
let gridFeedIn       = 0;

// Variablen für Mitternachtswerte
let gridConsumptionMN    = 0;
let batteryDischargeMN   = 0;
let batteryChargeMN      = 0;
let pvGenerationMN       = 0;
let gridFeedInMN         = 0;

// Variablen für berechnete Werte
let houseConsumption     = 0;
let directPVConsumption  = 0;
let incomeToday          = 0;
let selfSufficiencyToday = 0;
let selfConsumptionToday = 0;
let incomeTotal          = 0;
let selfSufficiencyTotal = 0;
let selfConsumptionTotal = 0;

function updateHouseConsumptionState(force = false)
{
    const houseConsumptionNew = gridConsumption + batteryDischarge + pvGeneration - batteryCharge - gridFeedIn;
    if (force || houseConsumptionNew > houseConsumption) {
        houseConsumption = houseConsumptionNew;
        setState (resultRootToday + houseConsumptionStateName, houseConsumption, true);
    }
}

function updateDirectPVConsumptionState(force = false)
{
    const directPVConsumptionNew = pvGeneration - batteryCharge - gridFeedIn;
    if (force || directPVConsumptionNew > directPVConsumption) {
        directPVConsumption = directPVConsumptionNew;
        setState (resultRootToday + directPVConsumptionStateName, directPVConsumption, true);
    }
}

function updateIncomeStates()
{
    incomeToday = roundTo (((pvGeneration - gridFeedIn) * priceBuy) + (gridFeedIn * priceSell), 2);
    setState (resultRootToday + incomeTodayStateName, incomeToday, true);

    incomeTotal = roundTo ((((pvGeneration + pvGenerationMN) - (gridFeedIn + gridFeedInMN)) * priceBuy) + ((gridFeedIn + gridFeedInMN) * priceSell), 2);
    setState (resultRootTotal + incomeTotalStateName, incomeTotal, true);
}

function updateSelfSufficiencyStates()
{
    selfSufficiencyToday = roundTo (((pvGeneration - gridFeedIn) * 100) / (gridConsumption + pvGeneration - gridFeedIn), 2);
    setState (resultRootToday + selfSufficiencyTodayStateName, selfSufficiencyToday, true);

    selfSufficiencyTotal = roundTo ((((pvGeneration + pvGenerationMN) - (gridFeedIn + gridFeedInMN)) * 100) / (gridConsumption + gridConsumptionMN + pvGeneration + pvGenerationMN - (gridFeedIn + gridFeedInMN)), 2);
    setState (resultRootTotal + selfSufficiencyTotalStateName, selfSufficiencyTotal, true);
}

function updateSelfConsumptionStates()
{
    selfConsumptionToday = roundTo (((pvGeneration - gridFeedIn) * 100) / pvGeneration, 2);
    setState (resultRootToday + selfConsumptionTodayStateName, selfConsumptionToday, true);

    selfConsumptionTotal = roundTo ((((pvGeneration + pvGenerationMN) - (gridFeedIn + gridFeedInMN)) * 100) / (pvGeneration + pvGenerationMN), 2);
    setState (resultRootTotal + selfConsumptionTotalStateName, selfConsumptionTotal, true);
}

function roundTo(num, precision) {
  const factor = Math.pow(10, precision)
  return Math.round(num * factor) / factor
}

async function copyMidnightState (stateName)
{
    setState (midnightRoot + stateName, getState (modbusRoot + stateName).val, true);
}

async function setResultState (resRoot, stateName, value)
{
    setState (resRoot + stateName, value, true);
}

async function copyMidnightStates()
{
    await copyMidnightState (gridConsumptionStateName);
    await copyMidnightState (batteryDischargeStateName);
    await copyMidnightState (batteryChargeStateName);
    await copyMidnightState (pvGenerationStateName);
    await copyMidnightState (gridFeedInStateName);
}

async function checkSourceState(srcRoot, stateName)
{
    if (!existsState(srcRoot+stateName)) {
        console.error(`Achtung: State "${srcRoot+stateName}" ist nicht vorhanden, wird aber für dieses Script benötigt!`);
    }
}

async function resetResultStates()
{
    await setResultState (resultRootToday, houseConsumptionStateName, 0);
    await setResultState (resultRootToday, directPVConsumptionStateName, 0);
    await setResultState (resultRootToday, gridConsumptionStateName, 0);
    await setResultState (resultRootToday, batteryDischargeStateName, 0);
    await setResultState (resultRootToday, batteryChargeStateName, 0);
    await setResultState (resultRootToday, pvGenerationStateName, 0);
    await setResultState (resultRootToday, gridFeedInStateName, 0);
    await setResultState (resultRootToday, incomeTodayStateName, 0);
    await setResultState (resultRootToday, selfSufficiencyTodayStateName, 0);
    await setResultState (resultRootToday, selfConsumptionTodayStateName, 0);

    await setResultState (resultRootTotal, incomeTotalStateName, 0);
    await setResultState (resultRootTotal, selfSufficiencyTotalStateName, 0);
    await setResultState (resultRootTotal, selfConsumptionTotalStateName, 0);
}

async function initState(resRoot, stateName, createMNState, unit)
{
    if (createMNState && !existsState (midnightRoot + stateName)) {
        await createStateAsync (midnightRoot + stateName, 0, {unit: unit, type: 'number'});
        await copyMidnightState (stateName);
    }

    if (!existsState (resRoot + stateName)) {
        await createStateAsync (resRoot + stateName, 0, {unit: unit, type: 'number'});
        await setResultState (resRoot, stateName, 0);
    }
}

async function initValues()
{
    gridConsumptionMN  = getState (midnightRoot + gridConsumptionStateName).val;
    batteryDischargeMN = getState (midnightRoot + batteryDischargeStateName).val;
    batteryChargeMN    = getState (midnightRoot + batteryChargeStateName).val;
    pvGenerationMN     = getState (midnightRoot + pvGenerationStateName).val;
    gridFeedInMN       = getState (midnightRoot + gridFeedInStateName).val;

    gridConsumption  = getState (resultRootToday + gridConsumptionStateName).val;
    batteryDischarge = getState (resultRootToday + batteryDischargeStateName).val;
    batteryCharge    = getState (resultRootToday + batteryChargeStateName).val;
    pvGeneration     = getState (resultRootToday + pvGenerationStateName).val;
    gridFeedIn       = getState (resultRootToday + gridFeedInStateName).val;

    updateHouseConsumptionState(true);
    updateDirectPVConsumptionState(true);

    incomeToday          = getState (resultRootToday + incomeTodayStateName).val;
    selfSufficiencyToday = getState (resultRootToday + selfSufficiencyTodayStateName).val;
    selfConsumptionToday = getState (resultRootToday + selfConsumptionTodayStateName).val;

    incomeTotal          = getState (resultRootTotal + incomeTotalStateName).val;
    selfSufficiencyTotal = getState (resultRootTotal + selfSufficiencyTotalStateName).val;
    selfConsumptionTotal = getState (resultRootTotal + selfConsumptionTotalStateName).val;
}

async function init()
{
    await checkSourceState (modbusRoot, gridConsumptionStateName);
    await checkSourceState (modbusRoot, batteryDischargeStateName);
    await checkSourceState (modbusRoot, batteryChargeStateName);
    await checkSourceState (modbusRoot, pvGenerationStateName);
    await checkSourceState (modbusRoot, gridFeedInStateName);

    await initState (resultRootToday, gridConsumptionStateName, true, 'kWh');
    await initState (resultRootToday, batteryDischargeStateName, true, 'kWh');
    await initState (resultRootToday, batteryChargeStateName, true, 'kWh');
    await initState (resultRootToday, pvGenerationStateName, true, 'kWh');
    await initState (resultRootToday, gridFeedInStateName, true, 'kWh');

    await initState (resultRootToday, houseConsumptionStateName, false, 'kWh');
    await initState (resultRootToday, directPVConsumptionStateName, false, 'kWh');

    await initState (resultRootToday, incomeTodayStateName, false, incomeUnit);
    await initState (resultRootToday, selfSufficiencyTodayStateName, false, '%');
    await initState (resultRootToday, selfConsumptionTodayStateName, false, '%');

    await initState (resultRootTotal, incomeTotalStateName, false, incomeUnit);
    await initState (resultRootTotal, selfSufficiencyTotalStateName, false, '%');
    await initState (resultRootTotal, selfConsumptionTotalStateName, false, '%');

    await initValues();

    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
}

init();

on({ id: modbusRoot + gridConsumptionStateName, change: 'ne' }, (obj) => {
    gridConsumption = obj.state.val - gridConsumptionMN;
    setState(resultRootToday + gridConsumptionStateName, gridConsumption, true);
    updateHouseConsumptionState();
    updateIncomeStates();
    updateSelfSufficiencyStates();
    updateSelfConsumptionStates();
});

on({ id: modbusRoot + batteryDischargeStateName, change: 'ne' }, (obj) => {
    batteryDischarge = obj.state.val - batteryDischargeMN;
    setState(resultRootToday + batteryDischargeStateName, batteryDischarge, true);
    updateHouseConsumptionState();
});

on({ id: modbusRoot + batteryChargeStateName, change: 'ne' }, (obj) => {

    batteryCharge = obj.state.val - batteryChargeMN;
    setState(resultRootToday + batteryChargeStateName, batteryCharge, true);
    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
});

on({ id: modbusRoot + pvGenerationStateName, change: 'ne' }, (obj) => {
    pvGeneration = obj.state.val - pvGenerationMN;
    setState(resultRootToday + pvGenerationStateName, pvGeneration, true);
    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
    updateIncomeStates();
    updateSelfSufficiencyStates();
    updateSelfConsumptionStates();
});

on({ id: modbusRoot + gridFeedInStateName, change: 'ne' }, (obj) => {
    gridFeedIn = obj.state.val - gridFeedInMN;
    setState(resultRootToday + gridFeedInStateName, gridFeedIn, true);
    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
    updateIncomeStates();
    updateSelfSufficiencyStates();
    updateSelfConsumptionStates();
});

// 5 Sekunden nach Mitternacht umspeichern der Modbus PV Energiewerte
if (resetAtMidnight) {
    schedule("5 0 0 * * *", async () => {
        await copyMidnightStates();
        await resetResultStates();
        await initValues();
        updateHouseConsumptionState();
        updateDirectPVConsumptionState();        
        updateIncomeStates();
        updateSelfSufficiencyStates();
        updateSelfConsumptionStates();
    });
}
