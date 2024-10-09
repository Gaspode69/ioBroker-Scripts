//--------------------------------------------------------------------------------------------------------------------------
// ioBroker JavaScript:
// Berechne aktuelle Tagessummen von Alpha-ESS Systemen auf Basis von Modbuswerten in W.
//
// Die State Namen entsprechen den Modbus Definitionen von hier:
// https://github.com/ioBroker/modbus-templates/blob/main/PV-Wechselrichter/Alpha-ESS/holding_register.txt
// Damit das Script unverändert funktioniert, muss der Modbus Adapter Instanz 0 sein und der Haken bei
// "Adresse nicht in ID aufnehmen" muss gesetzt sein.
//
// 23.02.2024  V1.0.0 (Gaspode) Erste Version
// 09.10.2024  V1.1.0 (Gaspode) Zähle Register modbus.0.holdingRegisters._Total_Active_power_(PVMeter) zur PV Leistung dazu
//--------------------------------------------------------------------------------------------------------------------------

let PV_values = [];
let Grid_values = [];

let pvTotal = 0;
let gridTotal = 0;
let batLoad = 0;

const resultRoot = '0_userdata.0.PV.now.';

const stateNamePVTotal   = resultRoot + 'PV_Total_Power';
const stateNameGridTotal = resultRoot + 'Grid_Total_Power';
const stateNameLoadTotal = resultRoot + 'Load_Total_Power';
const stateNameBatPower  = resultRoot + 'Battery_Power';

async function init() {
    await createStateAsync(stateNamePVTotal,0, {read:true, write:true, type:'number', unit:'W'});
    await createStateAsync(stateNameGridTotal,0, {read:true, write:true, type:'number', unit:'W'});
    await createStateAsync(stateNameLoadTotal,0, {read:true, write:true, type:'number', unit:'W'});
    await createStateAsync(stateNameBatPower,0, {read:true, write:true, type:'number', unit:'W'});

    batLoad = getState('modbus.0.holdingRegisters._Battery_Power').val;
    setState(stateNameBatPower, -batLoad);

    const PvResult=$('^modbus.0.holdingRegisters._PV*_power');
    
    PvResult.each((id, i)=> { 
        PV_values[id] = getState(id).val;
        if (i === PvResult.length - 1) {
            sumPV();
        }
    
        PV_values['modbus.0.holdingRegisters._Total_Active_power_(PVMeter)'] = getState('modbus.0.holdingRegisters._Total_Active_power_(PVMeter)').val;
    });

    const GridResult=$('^modbus.0.holdingRegisters._Active_power_of_*_phase_(Grid_Meter)');
    GridResult.each((id, i)=> { 
        Grid_values[id] = getState(id).val;
        if (i === GridResult.length - 1) {
            sumGrid();
        }
    });
}

on({ id: /^modbus\.0\.holdingRegisters\._PV.*_power/, change: 'ne' },
    function (obj) {
        PV_values[obj.id] = obj.state.val;
        sumPV();
    }
);

on({ id: 'modbus.0.holdingRegisters._Total_Active_power_(PVMeter)', change: 'ne' },
    function (obj) {
        PV_values[obj.id] = obj.state.val;
        sumPV();
    }
);


on({ id: /^modbus\.0\.holdingRegisters\._Active_power_of_.*_phase_\(Grid_Meter\)/, change: 'ne' },
    function (obj) {
        Grid_values[obj.id] = obj.state.val;
        sumGrid();
    }
);

on({ id: 'modbus.0.holdingRegisters._Battery_Power', change: 'ne' },
    function (obj) {
        batLoad = obj.state.val;
        setState(stateNameBatPower, batLoad);
        sumLoad();
    }
);

function sumPV() {
    pvTotal = 0;
    for (const id in PV_values) {
        pvTotal += PV_values[id];
    }
    setState(stateNamePVTotal, pvTotal);
    sumLoad();
}

function sumGrid() {
    gridTotal = 0;
    for (const id in Grid_values) {
        gridTotal += Grid_values[id];
    }
    setState(stateNameGridTotal, gridTotal);
    sumLoad();
}

function sumLoad() {
    setState(stateNameLoadTotal, pvTotal + gridTotal + batLoad);
}

init();
