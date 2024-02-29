//-------------------------------------------------------------------------------------------------------------------
// ioBroker JavaScript:
// Berechne den bisherigen Tagesverbrauch aller Verbraucher im Haushalt.
// Nachts um 0:00 Uhr werden die Tageswerte wieder auf 0 zurück gesetzt
// 
// Die State Namen entsprechen den Modbus Definitionen von hier:
// https://github.com/ioBroker/modbus-templates/blob/main/PV-Wechselrichter/Alpha-ESS/holding_register.txt
//
// 23.02.2024  V1.0.0 (Gaspode) Erste Version
// 25.02.2024  V1.0.1 (Gaspode) Ignoriere Tagessumme, wenn rückläufig
// 26.02.2024  V1.0.2 (Gaspode) Kleine Korrektur für rückläufige Tagessumme bei Script-Neustart
// 29.02.2024  V1.1.0 (Gaspode) Erlaube Unterdrückung der Rücksetzung um Mitternacht
//                              Berechne zusätzlich den Direktverbrauch der erzeugten PV Energie
//                              Diverse interne Anpassungen
//                              ACHTUNG: Der State Name für den GEsamtverbrauch wurde umbenannt von 
//                                       HoseLoad zu Consumption_House" 
//-------------------------------------------------------------------------------------------------------------------

// Setze auf false, wenn um Mitternacht nicht zurückgesetzt werden soll, sondern weitergezählt
const resetAtMidnight = true;

// Root Ordner im ioBroker Objektbaum:
const modbusRoot   = 'modbus.0.holdingRegisters.';
const midnightRoot = '0_userdata.0.PV.midnight.';
const resultRoot   = '0_userdata.0.PV.';

// Namen der Modbus States:
const gridConsumptionStateName  = '_Total_energy_consume_from_grid_(Grid_Meter)';
const batteryDischargeStateName = '_Battery_discharge_energy';
const batteryChargeStateName    = '_Battery_charge_energy';
const pvGenerationStateName     = '_Total_PV_Energy';
const gridFeedInStateName       = '_Total_energyfeed_to_grid_(Grid_Meter)';

// Namen der Ergebins States:
const houseConsumptionStateName    = 'Consumption_House';
const directPVConsumptionStateName = 'Consumption_DirectPV';


let gridConsumption  = 0;
let batteryDischarge = 0;
let batteryCharge    = 0;
let pvGeneration     = 0;
let gridFeedIn       = 0;

let gridConsumptionMN   = 0;
let batteryDischargeMN  = 0;
let batteryChargeMN     = 0;
let pvGenerationMN      = 0;
let gridFeedInMN        = 0;
let houseConsumption    = 0;
let directPVConsumption = 0;

function updateHouseConsumptionState()
{
    const houseConsumptionNew = gridConsumption + batteryDischarge + pvGeneration - batteryCharge - gridFeedIn;
    if (houseConsumptionNew > houseConsumption) {
        houseConsumption = houseConsumptionNew;
        setState (resultRoot + houseConsumptionStateName, houseConsumption);
    }
}

function updateDirectPVConsumptionState()
{
    const directPVConsumptionNew = pvGeneration - batteryCharge - gridFeedIn;
    if (directPVConsumptionNew > directPVConsumption) {
        directPVConsumption = directPVConsumptionNew;
        setState (resultRoot + directPVConsumptionStateName, directPVConsumption);
    }
}

async function copyMidnightState (stateName)
{
    setState (midnightRoot + stateName, getState (modbusRoot + stateName).val);
}

async function setResultState (stateName, value)
{
    setState (resultRoot + stateName, value);
}

async function copyMidnightStates()
{
    await copyMidnightState (gridConsumptionStateName);
    await copyMidnightState (batteryDischargeStateName);
    await copyMidnightState (batteryChargeStateName);
    await copyMidnightState (pvGenerationStateName);
    await copyMidnightState (gridFeedInStateName);
}

async function resetResultStates()
{
    await setResultState (gridConsumptionStateName, 0);
    await setResultState (batteryDischargeStateName, 0);
    await setResultState (batteryChargeStateName, 0);
    await setResultState (pvGenerationStateName, 0);
    await setResultState (gridFeedInStateName, 0);
}

async function initState(stateName, createMNState)
{
    if (createMNState && !existsState (midnightRoot + stateName)) {
        await createStateAsync (midnightRoot + stateName, 0, {unit: 'kWh', type: 'number'});
        await copyMidnightState (stateName);
    }

    if (!existsState (resultRoot + stateName)) {
        await createStateAsync (resultRoot + stateName, 0, {unit: 'kWh', type: 'number'});
        await setResultState (stateName, 0);
    }
}

async function initValues()
{
    gridConsumptionMN  = getState (midnightRoot + gridConsumptionStateName).val;
    batteryDischargeMN = getState (midnightRoot + batteryDischargeStateName).val;
    batteryChargeMN    = getState (midnightRoot + batteryChargeStateName).val;
    pvGenerationMN     = getState (midnightRoot + pvGenerationStateName).val;
    gridFeedInMN       = getState (midnightRoot + gridFeedInStateName).val;

    gridConsumption  = getState (resultRoot + gridConsumptionStateName).val;
    batteryDischarge = getState (resultRoot + batteryDischargeStateName).val;
    batteryCharge    = getState (resultRoot + batteryChargeStateName).val;
    pvGeneration     = getState (resultRoot + pvGenerationStateName).val;
    gridFeedIn       = getState (resultRoot + gridFeedInStateName).val;

    houseConsumption    = getState (resultRoot + houseConsumptionStateName).val;
    directPVConsumption = getState (resultRoot + directPVConsumptionStateName).val;
}

async function init()
{
    await initState (gridConsumptionStateName, true);
    await initState (batteryDischargeStateName, true);
    await initState (batteryChargeStateName, true);
    await initState (pvGenerationStateName, true);
    await initState (gridFeedInStateName, true);

    await initState (houseConsumptionStateName, false);
    await initState (directPVConsumptionStateName, false);

    await initValues();

    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
}

init();

on({ id: modbusRoot + gridConsumptionStateName, change: 'ne' }, (obj) => {
    gridConsumption = obj.state.val - gridConsumptionMN;
    setState(resultRoot + gridConsumptionStateName, gridConsumption);
    updateHouseConsumptionState();
});

on({ id: modbusRoot + batteryDischargeStateName, change: 'ne' }, (obj) => {
    batteryDischarge = obj.state.val - batteryDischargeMN;
    setState(resultRoot + batteryDischargeStateName, batteryDischarge);
    updateHouseConsumptionState();
});

on({ id: modbusRoot + batteryChargeStateName, change: 'ne' }, (obj) => {
    batteryCharge = obj.state.val - batteryChargeMN;
    setState(resultRoot + batteryChargeStateName, batteryCharge);
    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
});

on({ id: modbusRoot + pvGenerationStateName, change: 'ne' }, (obj) => {
    pvGeneration = obj.state.val - pvGenerationMN;
    setState(resultRoot + pvGenerationStateName, pvGeneration);
    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
});

on({ id: modbusRoot + gridFeedInStateName, change: 'ne' }, (obj) => {
    gridFeedIn = obj.state.val - gridFeedInMN;
    setState(resultRoot + gridFeedInStateName, gridFeedIn);
    updateHouseConsumptionState();
    updateDirectPVConsumptionState();
});

// 5 Sekunden nach Mitternacht umspeichern der Modbus PV Energiewerte
if (resetAtMidnight) {
    schedule("5 0 0 * * *", async () => {
        await copyMidnightStates();
        await resetResultStates();
        await initValues();
        houseConsumption = 0;
        directPVConsumption = 0;
        updateHouseConsumptionState();
        updateDirectPVConsumptionState();        
    });
}
