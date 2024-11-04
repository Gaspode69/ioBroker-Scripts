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
// 04.11.2024  V1.1.1 (Gaspode) Setze Systemzeit; Setze ACK auf True beim Schreiben von States
// 04.11.2024  V1.2.0 (Gaspode) Berechne Systemzeit
// 04.11.2024  V1.2.2 (Gaspode) Systemzeit wird geschrieben, wenn der State entspechend geändert wird (muss aktiviert werden, s.u.).
//--------------------------------------------------------------------------------------------------------------------------

// Da das Setzen der Systemzeit einen Eingriff in das System bedeutet, ist diese Funktion per Default aus Sicherheitsgründen deaktiviert!
// Zum Aktivieren der Funktion, die folgende Variable auf true gesetzt werden.
// !!! Verwenden dieser Funktion auf eigenes Risiko !!!
const allowSystemTimeSetting = false;

let PV_values = [];
let Grid_values = [];
let SysTime_values = [];

let pvTotal = 0;
let gridTotal = 0;
let batLoad = 0;

const resultRoot = '0_userdata.0.PV.now.';

const stateNamePVTotal   = resultRoot + 'PV_Total_Power';
const stateNameGridTotal = resultRoot + 'Grid_Total_Power';
const stateNameLoadTotal = resultRoot + 'Load_Total_Power';
const stateNameBatPower  = resultRoot + 'Battery_Power';
const stateSystemTime    = resultRoot + 'System_Time';

async function init() {
    await createStateAsync(stateNamePVTotal,0, {read:true, write:false, type:'number', unit:'W'});
    await createStateAsync(stateNameGridTotal,0, {read:true, write:false, type:'number', unit:'W'});
    await createStateAsync(stateNameLoadTotal,0, {read:true, write:false, type:'number', unit:'W'});
    await createStateAsync(stateNameBatPower,0, {read:true, write:false, type:'number', unit:'W'});
    await createStateAsync(stateSystemTime,0, {read:true, write:true, type:'string'});

    batLoad = getState('modbus.0.holdingRegisters._Battery_Power').val;
    setState(stateNameBatPower, -batLoad, true);

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

    const SysTimeResult=$('^modbus.0.holdingRegisters._System_time_:_*');
    SysTimeResult.each((id, i)=> { 
        SysTime_values[id] = getState(id).val;
        if (i === SysTimeResult.length - 1) {
            decodeSystemTime();
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
        setState(stateNameBatPower, batLoad, true);
        sumLoad();
    }
);


on({ id: /^modbus\.0\.holdingRegisters\._System_time_:_.*/, change: 'ne' },
    function (obj) {
        SysTime_values[obj.id] = obj.state.val;
        decodeSystemTime();
    }
);

on({ id: stateSystemTime, ack: false },
    function (obj) {
        let isValid = true;
        const regex = /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}/;

        if (!regex.test(obj.state.val)) {
            isValid = false;
        } else {
            let [datePart, timePart] = obj.state.val.split(', ');
            let [day, month, year] = datePart.split('.').map(num => parseInt(num, 10));
            let [hour, minute, second] = timePart.split(':').map(num => parseInt(num, 10));

            if (year < 1000 || year > 9999) isValid = false;
            if (month < 1 || month > 12) isValid = false;
            if (day < 1 || day > 31) isValid = false;
            if (hour < 0 || hour > 23) isValid = false;
            if (minute < 0 || minute > 59) isValid = false;
            if (second < 0 || second > 59) isValid = false;

            if (isValid) {
                const yearMonth    = ((year - 2000) << 8) | month;
                const dayHour      = (day << 8) | hour;
                const minuteSecond = (minute << 8) | second;

                if (allowSystemTimeSetting) {
                    console.info('Setze Systemzeit:');
                    setState('modbus.0.holdingRegisters._System_time_:_(year)-(month)', yearMonth);
                    setState('modbus.0.holdingRegisters._System_time_:_(day)-(hour)', dayHour);
                    setState('modbus.0.holdingRegisters._System_time_:_(minute)-(second)', minuteSecond);
                }
                else {
                    console.warn('Neue Systemzeit nicht gesetzt, da deaktiviert!');
                }

                console.info(`Jahr und Monat (0x${yearMonth.toString(16)}):`+ yearMonth);
                console.info(`Tag und Stunde (0x${dayHour.toString(16)}):`+ dayHour);
                console.info(`Minute und Sekunde (0x${minuteSecond.toString(16)}):`+ minuteSecond);


            }
            else {
                console.error('Systemzeit nicht gesetzt, Zeitangabe ungültig!');
            }
        }
    }
);

function sumPV() {
    pvTotal = 0;
    for (const id in PV_values) {
        pvTotal += PV_values[id];
    }
    setState(stateNamePVTotal, pvTotal, true);
    sumLoad();
}

function sumGrid() {
    gridTotal = 0;
    for (const id in Grid_values) {
        gridTotal += Grid_values[id];
    }
    setState(stateNameGridTotal, gridTotal, true);
    sumLoad();
}

function sumLoad() {
    setState(stateNameLoadTotal, pvTotal + gridTotal + batLoad, true);
}

function decodeSystemTime() {
    const YearMonth    = SysTime_values['modbus.0.holdingRegisters._System_time_:_(year)-(month)'];
    const DayHour      = SysTime_values['modbus.0.holdingRegisters._System_time_:_(day)-(hour)'];
    const MinuteSecond = SysTime_values['modbus.0.holdingRegisters._System_time_:_(minute)-(second)'];

    const year = (YearMonth >> 8) + 2000;
    const month = YearMonth & 0xFF;
    const day = DayHour >> 8;
    const hour = DayHour & 0xFF;
    const minute = MinuteSecond >> 8;
    const second = MinuteSecond & 0xFF;

    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,  // 24-Stunden-Format
        timeZoneName: 'short'
    };
    setState(stateSystemTime, new Date(year, month - 1, day, hour, minute, second).toLocaleString('de-DE', options), true);
}

init();
