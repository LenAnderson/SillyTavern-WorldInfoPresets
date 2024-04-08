import { callPopup, getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { executeSlashCommands, registerSlashCommand } from '../../../slash-commands.js';
import { importWorldInfo, world_info } from '../../../world-info.js';




class Settings {
    static from(props) {
        props.presetList = props.presetList?.map(it=>Preset.from(it)) ?? [];
        const instance = Object.assign(new this(), props);
        extension_settings.worldInfoPresets = instance;
        return instance;
    }
    /**@type {String}*/ presetName;
    /**@type {Preset[]}*/ presetList = [];
    get preset() {
        return this.presetList.find(it=>it.name == this.presetName);
    }
}
class Preset {
    static from(props) {
        const instance = Object.assign(new this(), props);
        return instance;
    }
    /**@type {String}*/ name;
    /**@type {String[]}*/ worldList = [];

    toJSON() {
        return {
            name: this.name,
            worldList: this.worldList,
        };
    }
}
/**@type {Settings}*/
const settings = Settings.from(extension_settings.worldInfoPresets ?? {});

/**@type {HTMLSelectElement}*/
let presetSelect;

const activatePresetByName = async(name)=>{
    await activatePreset(settings.presetList.find(it=>it.name.toLowerCase() == name.toLowerCase()));
};
const activatePreset = async(preset)=>{
    //TODO use delta instead of brute force
    await executeSlashCommands('/world silent=true {{newline}}');
    settings.presetName = preset?.name ?? '';
    updateSelect();
    if (preset) {
        for (const world of settings.presetList.find(it=>it.name == settings.presetName).worldList) {
            await executeSlashCommands(`/world silent=true ${world}`);
        }
    }
};

const updateSelect = ()=>{
    /**@type {HTMLOptionElement[]}*/
    // @ts-ignore
    const opts = Array.from(presetSelect.children);

    const added = [];
    const removed = [];
    const updated = [];
    for (const preset of settings.presetList) {
        const opt = opts.find(opt=>opt.value.toLowerCase() == preset.name.toLowerCase());
        if (opt) {
            if (opt.value != preset.name) {
                updated.push({ preset, opt });
            }
        } else {
            added.push(preset);
        }
    }
    for (const opt of opts) {
        if (opt.value == '') continue;
        if (settings.presetList.find(preset=>opt.value.toLowerCase() == preset.name.toLowerCase())) continue;
        removed.push(opt);
    }
    for (const opt of removed) {
        opt.remove();
        opts.splice(opts.indexOf(opt), 1);
    }
    for (const update of updated) {
        update.opt.value = update.preset.name;
        update.opt.textContent = update.preset.name;
    }
    const sortedOpts = opts.toSorted((a,b)=>a.value.toLowerCase().localeCompare(b.value.toLowerCase()));
    sortedOpts.forEach((opt, idx)=>{
        if (presetSelect.children[idx] != opt) {
            presetSelect.children[idx].insertAdjacentElement('beforebegin', opt);
        }
    });
    for (const preset of added) {
        const opt = document.createElement('option'); {
            opt.value = preset.name;
            opt.textContent = preset.name;
            const before = Array.from(presetSelect.children).find(it=>it.value.toLowerCase().localeCompare(preset.name.toLowerCase()) == 1);
            if (before) before.insertAdjacentElement('beforebegin', opt);
            else presetSelect.append(opt);
        }
    }
    presetSelect.value = settings.presetName;
};

const loadBook = async(name)=>{
    const result = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name }),
    });
    if (result.ok) {
        const data = await result.json();
        data.entries = Object.keys(data.entries).map(it=>{
            data.entries[it].book = name;
            return data.entries[it];
        });
        data.book = name;
        return data;
    } else {
        toastr.warning(`Failed to load World Info book: ${name}`);
    }
};


const importBooks = async(data)=>{
    if (data.books && Object.keys(data.books).length > 0) {
        const doImport = await callPopup(`<h3>The preset contains World Info books. Import the books?<h3>`, 'confirm');
        if (doImport) {
            for (const key of Object.keys(data.books)) {
                const book = data.books[key];
                const blob = new Blob([JSON.stringify(book)], { type:'text' });
                const file = new File([blob], `${key}.json`);
                await importWorldInfo(file);
            }
        }
    }
};

/**
 *
 * @param {FileList} files
 */
const importPreset = async(files)=>{
    for (let i = 0; i < files.length; i++) {
        await importSinglePreset(files.item(i));
    }
};
/**
 *
 * @param {File} file
 */
const importSinglePreset = async(file)=>{
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        let old = settings.presetList.find(it=>it.name.toLowerCase() == data.name.toLowerCase());
        while (old) {
            const popupText = `
                <h3>Import World Info Preset: "${data.name}"</3>
                <h4>
                    A preset by that name already exists. Change the name to import under a new name,
                    or keep the name to ovewrite the existing preset.
                </h4>
            `;
            const newName = await callPopup(popupText, 'input', data.name);
            if (newName == data.name) {
                const overwrite = await callPopup(`<h3>Overwrite World Info Preset "${newName}"?</h3>`, 'confirm');
                if (overwrite) {
                    old.worldList = data.worldList;
                    await importBooks(data);
                    if (settings.preset == old) {
                        activatePreset(old);
                        saveSettingsDebounced();
                    }
                }
                return;
            } else {
                data.name = newName;
                old = settings.presetList.find(it=>it.name.toLowerCase() == data.name.toLowerCase());
            }
        }
        const preset = new Preset();
        preset.name = data.name;
        preset.worldList = data.worldList;
        settings.presetList.push(preset);
        await importBooks(data);
        updateSelect();
        saveSettingsDebounced();
    } catch (ex) {
        toastr.error(`Failed to import "${file.name}":\n\n${ex.message}`);
    }
};

const createPreset = async()=>{
    const name = await callPopup('<h3>Preset Name:</h3>', 'input', settings.presetName);
    if (!name) return;
    const preset = new Preset();
    preset.name = name;
    preset.worldList = [...world_info.globalSelect];
    settings.presetList.push(preset);
    settings.presetName = name;
    updateSelect();
    saveSettingsDebounced();
};



const init = ()=>{
    const container = document.querySelector('#WIMultiSelector');
    const dom = document.createElement('div'); {
        dom.classList.add('stwip--container');
        const label = document.createElement('div'); {
            label.classList.add('stwip--label');
            label.textContent = 'Presets: ';
            dom.append(label);
        }
        presetSelect = document.createElement('select'); {
            presetSelect.classList.add('stwip--preset');
            const blank = document.createElement('option'); {
                blank.value = '';
                blank.textContent = '--- Pick a Preset ---';
                presetSelect.append(blank);
            }
            for (const preset of settings.presetList.toSorted((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
                const opt = document.createElement('option'); {
                    opt.value = preset.name;
                    opt.textContent = preset.name;
                    opt.title = preset.worldList.join(', ');
                    presetSelect.append(opt);
                }
            }
            presetSelect.value = settings.presetName ?? '';
            presetSelect.addEventListener('change', async()=>{
                await activatePresetByName(presetSelect.value);
            });
            dom.append(presetSelect);
        }
        const actions = document.createElement('div'); {
            actions.classList.add('stwip--actions');
            const btnRename = document.createElement('div'); {
                btnRename.classList.add('stwip--action');
                btnRename.classList.add('menu_button');
                btnRename.classList.add('fa-solid', 'fa-pencil');
                btnRename.title = 'Rename current preset';
                btnRename.addEventListener('click', async()=>{
                    const name = await callPopup('<h3>Rename Preset:</h3>', 'input', settings.presetName);
                    if (!name) return;
                    settings.preset.name = name;
                    settings.presetName = name;
                    updateSelect();
                    saveSettingsDebounced();
                });
                actions.append(btnRename);
            }
            const btnUpdate = document.createElement('div'); {
                btnUpdate.classList.add('stwip--action');
                btnUpdate.classList.add('menu_button');
                btnUpdate.classList.add('fa-solid', 'fa-save');
                btnUpdate.title = 'Update current preset';
                btnUpdate.addEventListener('click', ()=>{
                    if (!settings.preset) return createPreset();
                    settings.preset.worldList = [...world_info.globalSelect];
                    saveSettingsDebounced();
                });
                actions.append(btnUpdate);
            }
            const btnCreate = document.createElement('div'); {
                btnCreate.classList.add('stwip--action');
                btnCreate.classList.add('menu_button');
                btnCreate.classList.add('fa-solid', 'fa-file-circle-plus');
                btnCreate.title = 'Save current preset as';
                btnCreate.addEventListener('click', async()=>createPreset());
                actions.append(btnCreate);
            }
            const btnRestore = document.createElement('div'); {
                btnRestore.classList.add('stwip--action');
                btnRestore.classList.add('menu_button');
                btnRestore.classList.add('fa-solid', 'fa-rotate-left');
                btnRestore.title = 'Restore current preset';
                btnRestore.addEventListener('click', ()=>activatePreset(settings.preset));
                actions.append(btnRestore);
            }
            const importFile = document.createElement('input'); {
                importFile.classList.add('stwip--importFile');
                importFile.type = 'file';
                importFile.addEventListener('change', async()=>{
                    await importPreset(importFile.files);
                    importFile.value = null;
                });
            }
            const btnImport = document.createElement('div'); {
                btnImport.classList.add('stwip--action');
                btnImport.classList.add('menu_button');
                btnImport.classList.add('fa-solid', 'fa-file-import');
                btnImport.title = 'Import preset';
                btnImport.addEventListener('click', ()=>importFile.click());
                actions.append(btnImport);
            }
            const btnExport = document.createElement('div'); {
                btnExport.classList.add('stwip--action');
                btnExport.classList.add('menu_button');
                btnExport.classList.add('fa-solid', 'fa-file-export');
                btnExport.title = 'Export the current preset';
                btnExport.addEventListener('click', async()=>{
                    const popupText = `
                        <h3>Export World Info Preset: "${settings.presetName}"</h3>
                        <h4>Include the books' contents in the exported file?</h4>
                    `;
                    const includeBooks = await callPopup(popupText, 'confirm');
                    const data = settings.preset.toJSON();
                    if (includeBooks) {
                        let names = world_info.globalSelect;
                        const books = {};
                        for (const book of names) {
                            books[book] = await loadBook(book);
                        }
                        data.books = books;
                    }
                    const blob = new Blob([JSON.stringify(data)], { type:'text' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); {
                        a.href = url;
                        const name = `SillyTavern-WorldInfoPreset-${settings.presetName}`;
                        const ext = 'json';
                        a.download = `${name}.${ext}`;
                        a.click();
                    }
                });
                actions.append(btnExport);
            }
            const btnDelete = document.createElement('div'); {
                btnDelete.classList.add('stwip--action');
                btnDelete.classList.add('menu_button');
                btnDelete.classList.add('redWarningBG');
                btnDelete.classList.add('fa-solid', 'fa-trash-can');
                btnDelete.title = 'Delete the current preset';
                btnDelete.addEventListener('click', ()=>{
                    settings.presetList.splice(settings.presetList.indexOf(settings.preset), 1);
                    settings.presetName = '';
                    updateSelect();
                    saveSettingsDebounced();
                });
                actions.append(btnDelete);
            }
            dom.append(actions);
        }
        container.children[0].insertAdjacentElement('beforebegin', dom);
    }
};
init();



registerSlashCommand('wipreset',
    (args, value)=>{
        activatePresetByName(value);
    },
    [],
    '<span class="monospace">(optional preset name)</span> – Activate a World Info preset. Leave name blank to deactivate current preset (unload all WI books).',
    true,
    true,
);