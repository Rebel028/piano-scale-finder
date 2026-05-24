// --- STATE & CONFIG ---
let audioContextStarted = false;
let selectedNotes = new Set(); // Stores specific notes e.g., "C4"
let baseOctave = 2; // Keyboard starts at C2
let numKeys = 49; // 4 octaves
let currentPreview = null; // Stores the currently previewed scale/chord

// Tonal.js theory dictionaries
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Weights for sorting logic based on prompt rules
const scaleWeights = {
    "major": 1, "minor": 1,
    "dorian": 2, "phrygian": 2, "lydian": 2, "mixolydian": 2, "locrian": 2,
    "major pentatonic": 3, "minor pentatonic": 3
};

const chordWeights = {
    "M": 1, "m": 1, "dim": 1, "aug": 1,
    "maj7": 2, "m7": 2, "7": 2, "m7b5": 2, "dim7": 2,
    "sus2": 3, "sus4": 3, "add9": 3,
    "9": 4, "m9": 4, "maj9": 4
};

// --- AUDIO SETUP ---
let sampler;
let synthFallback;

function initAudio() {
    synthFallback = new Tone.PolySynth(Tone.Synth).toDestination();
    synthFallback.volume.value = -8;

    sampler = new Tone.Sampler({
        urls: {
            "A0": "A0.mp3", "C1": "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3", "A1": "A1.mp3",
            "C2": "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", "A2": "A2.mp3",
            "C3": "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", "A3": "A3.mp3",
            "C4": "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", "A4": "A4.mp3",
            "C5": "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", "A5": "A5.mp3",
            "C6": "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3", "A6": "A6.mp3",
            "C7": "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3", "A7": "A7.mp3"
        },
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        onload: () => {
            document.getElementById('loading-overlay').style.display = 'none';
        },
        onerror: () => {
            console.warn("Piano samples failed to load. Falling back to oscillator synth.");
            sampler = synthFallback;
            document.getElementById('loading-overlay').style.display = 'none';
        }
    }).toDestination();

    // Safety timeout for overlay removal
    setTimeout(() => { document.getElementById('loading-overlay').style.display = 'none'; }, 6000);
}

async function ensureAudio() {
    if (!audioContextStarted) {
        await Tone.start();
        audioContextStarted = true;
    }
}

function playNote(noteName) {
    ensureAudio();
    if (sampler.loaded || sampler === synthFallback) {
        sampler.triggerAttackRelease(noteName, "2n");
    }
}

// --- KEYBOARD RENDERING ---
function isBlackKey(noteName) {
    return noteName.includes('#') || noteName.includes('b');
}

function renderKeyboard() {
    const keyboardEl = document.getElementById('keyboard');
    keyboardEl.innerHTML = '';

    let startMidi = 12 + (baseOctave * 12); // Midi number for C of baseOctave
    document.getElementById('octave-display').innerText = `Octaves ${baseOctave}-${baseOctave + Math.floor(numKeys / 12)}`;

    for (let i = 0; i < numKeys; i++) {
        // Replace the inside of the for-loop in renderKeyboard() with this:
        let noteMidi = startMidi + i;
        let noteName = Tonal.Note.fromMidi(noteMidi);

        let keyBtn = document.createElement('div');
        keyBtn.className = `key ${isBlackKey(noteName) ? 'black' : 'white'}`;
        keyBtn.dataset.note = noteName;
        keyBtn.id = `key-${noteName}`;

        let cleanName = noteName.replace(/(\d+)/, '');
        let displayName = formatNoteName(cleanName);

        // --- PREVIEW LOGIC ---
        let previewClass = '';
        let tooltipText = '';
        let isPreviewNote = false;

        if (currentPreview) {
            const { type, data } = currentPreview;
            const chroma = Tonal.Note.chroma(noteName);

            // Check if this key's chroma exists in the previewed scale/chord
            let noteIndex = data.notes.findIndex(n => Tonal.Note.chroma(n) === chroma);
            if (noteIndex !== -1) {
                let interval = data.intervals[noteIndex];
                let role = getRoleInfo(type, interval);
                previewClass = `preview-${role.classSuffix}`;
                tooltipText = `${role.name} (${formatNoteName(data.notes[noteIndex])})`;
                isPreviewNote = true;
            }
        }

        // Apply selected / preview classes
        if (selectedNotes.has(noteName)) keyBtn.classList.add('selected');
        if (previewClass) keyBtn.classList.add(previewClass);
        if (tooltipText) keyBtn.setAttribute('data-tooltip', tooltipText);

        // Name label span
        let labelSpan = document.createElement('span');
        labelSpan.className = "key-label";
        labelSpan.innerText = (selectedNotes.has(noteName) || isPreviewNote)
            ? displayName
            : (noteName.startsWith('C') && !noteName.includes('#') ? displayName : '');

        keyBtn.appendChild(labelSpan);

        keyBtn.addEventListener('mousedown', () => {
            ensureAudio();
            if (selectedNotes.has(noteName)) {
                selectedNotes.delete(noteName);
                updateResults();
            } else {
                triggerNote(noteName, true);
            }
        });

        keyBtn.addEventListener('mouseup', () => keyBtn.classList.remove('active'));
        keyBtn.addEventListener('mouseleave', () => keyBtn.classList.remove('active'));

        keyboardEl.appendChild(keyBtn);
    }
}

function shiftOctave(dir) {
    let newOctave = baseOctave + dir;
    if (newOctave >= 0 && newOctave <= 6) {
        baseOctave = newOctave;
        renderKeyboard();
    }
}

function formatNoteName(note) {
    if (!note) return "";
    const useSharps = document.getElementById('accidental-toggle').checked;

    // Get the 12-tone index of the note (0-11)
    const chroma = Tonal.Note.chroma(note);
    if (chroma === undefined || chroma === null) return note;

    return useSharps ? SHARPS[chroma] : FLATS[chroma];
}

// --- INTERACTION & LOGIC ---
function triggerNote(noteName, fromUI = false) {
    playNote(noteName);

    // Add to selection pool
    selectedNotes.add(noteName);

    // Update Visuals
    const keyEl = document.getElementById(`key-${noteName}`);
    if (keyEl) {
        keyEl.classList.add('selected');
        let cleanName = noteName.replace(/(\d+)/, ''); // Remove octave number
        keyEl.querySelector('.key-label').innerText = formatNoteName(cleanName); // Uses helper
    }

    updateResults();
}

function resetSelection() {
    selectedNotes.clear();
    currentPreview = null
    renderKeyboard();
    document.getElementById('scales-list').innerHTML = "Select notes to find scales...";
    document.getElementById('chords-list').innerHTML = "Select notes to find chords...";
}

// --- THEORY CALCULATION (TONAL.JS) ---
function getSelectedPitchClasses() {
    // Convert to chromas (0-11) to avoid enharmonic spelling issues (e.g. D# vs Eb)
    let chromas = new Set();
    selectedNotes.forEach(n => chromas.add(Tonal.Note.chroma(n)));
    return Array.from(chromas);
}

function isSubset(subsetChromas, supersetNotes) {
    if (subsetChromas.length === 0) return false;
    const superChromas = supersetNotes.map(n => Tonal.Note.chroma(n));
    return subsetChromas.every(c => superChromas.includes(c));
}

// --- RESULTS ORCHESTRATION ---
function updateResults() {
    const chromas = getSelectedPitchClasses();
    
    // Clear preview states on any interaction
    currentPreview = null; 
    if (typeof renderLegend === 'function') renderLegend(); 
    
    // REDRAW KEYBOARD
    renderKeyboard();

    if (chromas.length === 0) {
        resetSelection();
        return;
    }

    // Get formatting & limit preferences
    const useSharps = document.getElementById('accidental-toggle').checked;
    const roots = useSharps ? SHARPS : FLATS;
    
    const limitValue = document.getElementById('result-limit').value;
    const limit = limitValue === 'all' ? Infinity : parseInt(limitValue, 10);

    // Delegate to modular search functions
    const matchedScales = findScales(chromas, roots, limit);
    const matchedChords = findChords(chromas, roots, limit);

    renderResults(matchedScales, matchedChords, chromas.length);
}

// --- SCALE SEARCH LOGIC ---
function findScales(chromas, roots, limit) {
    if (chromas.length < 3) return []; // Optimization: Scales require at least 3 notes

    let matchedScales = [];
    const allScaleTypes = Tonal.ScaleType.all();

    for (let root of roots) {
        for (let typeObj of allScaleTypes) {
            let scale = Tonal.Scale.get(`${root} ${typeObj.name}`);
            if (scale.empty) continue;
            
            if (isSubset(chromas, scale.notes)) {
                let weight = scaleWeights.hasOwnProperty(typeObj.name) ? scaleWeights[typeObj.name] : 100;
                matchedScales.push({
                    name: scale.name,
                    notes: scale.notes.join(' '),
                    weight: weight,
                    length: scale.notes.length
                });
            }
        }
    }

    matchedScales.sort((a, b) => {
        if (a.weight !== b.weight) return a.weight - b.weight;
        if (a.length !== b.length) return a.length - b.length;
        return a.name.localeCompare(b.name);
    });

    return matchedScales.slice(0, limit);
}

// --- CHORD SEARCH LOGIC ---
function findChords(chromas, roots, limit) {
    if (chromas.length < 2) return []; // Optimization: Chords require at least 2 notes

    let matchedChords = [];
    const allChordTypes = Tonal.ChordType.all();

    for (let root of roots) {
        for (let typeObj of allChordTypes) {
            let chord = Tonal.Chord.get(`${root}${typeObj.aliases[0]}`);
            if (chord.empty) continue;
            
            if (isSubset(chromas, chord.notes)) {
                let weight = 100; 
                for (let alias of typeObj.aliases) {
                    if (chordWeights.hasOwnProperty(alias)) {
                        weight = chordWeights[alias];
                        break; 
                    }
                }

                matchedChords.push({
                    name: chord.name,
                    notes: chord.notes.join(' '),
                    weight: weight,
                    length: chord.notes.length
                });
            }
        }
    }

    matchedChords.sort((a, b) => {
        if (a.weight !== b.weight) return a.weight - b.weight;
        if (a.length !== b.length) return a.length - b.length;
        return a.name.localeCompare(b.name);
    });

    return matchedChords.slice(0, limit);
}

// --- DOM RENDERING ---
function renderResults(scales, chords, chromasLength) {
    const scaleContainer = document.getElementById('scales-list');
    const chordContainer = document.getElementById('chords-list');

    // Scale Output Handling
    if (chromasLength < 3) {
        scaleContainer.innerHTML = "<em>Select at least 3 notes to search for scales...</em>";
    } else if (scales.length === 0) {
        scaleContainer.innerHTML = "<em>No common scales found matching these notes.</em>";
    } else {
        scaleContainer.innerHTML = scales.map(s => `
            <div class="result-item" onclick="previewItem('scale', '${s.name}')">
                <div class="result-name">${s.name}</div>
                <div class="result-notes">${s.notes.split(' ').map(n => formatNoteName(n)).join(' ')}</div>
            </div>
        `).join('');
    }

    // Chord Output Handling
    if (chromasLength < 2) {
        chordContainer.innerHTML = "<em>Select at least 2 notes to search for chords...</em>";
    } else if (chords.length === 0) {
        chordContainer.innerHTML = "<em>No common chords found matching these notes.</em>";
    } else {
        chordContainer.innerHTML = chords.map(c => `
            <div class="result-item" onclick="previewItem('chord', '${c.name}')">
                <div class="result-name">${c.name}</div>
                <div class="result-notes">${c.notes.split(' ').map(n => formatNoteName(n)).join(' ')}</div>
            </div>
        `).join('');
    }
}

// --- MIDI INTEGRATION ---
let midiAccess = null;
let activeMidiInput = null;

function onMIDISuccess(access) {
    midiAccess = access;
    populateMIDIDropdown();

    midiAccess.onstatechange = (e) => {
        populateMIDIDropdown();
    };
}

function populateMIDIDropdown() {
    const selectBox = document.getElementById('midi-select');
    const currentSelection = selectBox.value;

    selectBox.innerHTML = '';
    let hasDevices = false;

    for (let input of midiAccess.inputs.values()) {
        hasDevices = true;
        let option = document.createElement('option');
        option.value = input.id;
        option.text = input.name || `Unknown MIDI Device`;
        selectBox.appendChild(option);
    }

    if (!hasDevices) {
        // Create a fake clickable option to re-trigger a hardware poll
        let option = document.createElement('option');
        option.value = "retry";
        option.text = "⚠️ No devices found. Click to rescan...";
        selectBox.appendChild(option);
    } else {
        if (currentSelection && midiAccess.inputs.has(currentSelection)) {
            selectBox.value = currentSelection;
        } else {
            const firstInput = midiAccess.inputs.values().next().value;
            selectBox.value = firstInput.id;
            selectMidiInput(firstInput.id);
        }
    }
}

function selectMidiInput(inputId) {
    if (activeMidiInput) activeMidiInput.onmidimessage = null; // Clear old listener
    if (!inputId) return;

    activeMidiInput = midiAccess.inputs.get(inputId);
    if (activeMidiInput) {
        activeMidiInput.onmidimessage = getMIDIMessage;
        console.log(`Connected to: ${activeMidiInput.name}`);
    }
}

function handleMidiStateChange(e) {
    // Re-populate list if devices change
    if (e.port.type === "input") {
        const selectBox = document.getElementById('midi-select');
        let exists = Array.from(selectBox.options).some(opt => opt.value === e.port.id);

        if (e.port.state === "connected" && !exists) {
            let option = document.createElement('option');
            option.value = e.port.id;
            option.text = e.port.name;
            selectBox.appendChild(option);
            if (!activeMidiInput) {
                selectBox.value = e.port.id;
                selectMidiInput(e.port.id);
            }
        } else if (e.port.state === "disconnected" && exists) {
            Array.from(selectBox.options).forEach(opt => {
                if (opt.value === e.port.id) opt.remove();
            });
        }
    }
}

function onMIDIFailure() {
    console.warn("Could not access your MIDI devices.");
    document.getElementById('midi-select').innerHTML = '<option value="">MIDI Not Supported/Allowed</option>';
}

function getMIDIMessage(message) {
    let command = message.data[0];
    let note = message.data[1];
    let velocity = (message.data.length > 2) ? message.data[2] : 0;

    // Note On
    if (command >= 144 && command <= 159 && velocity > 0) {
        let noteName = Tonal.Note.fromMidi(note);
        // Visual active state handling
        const keyEl = document.getElementById(`key-${noteName}`);
        if (keyEl) keyEl.classList.add('active');

        triggerNote(noteName);
    }

    // Note Off
    if (command >= 128 && command <= 143 || (command >= 144 && command <= 159 && velocity === 0)) {
        let noteName = Tonal.Note.fromMidi(note);
        const keyEl = document.getElementById(`key-${noteName}`);
        if (keyEl) keyEl.classList.remove('active');
    }
}

// -- PREVIEW -- /
function getRoleInfo(type, interval) {
    let num = interval.replace(/\D/g, ''); // Extract the interval number (e.g., '3' from '3M')
    if (type === 'scale') {
        if (num === '1') return { name: 'Tonic', classSuffix: 'tonic' };
        if (num === '4') return { name: 'Subdominant', classSuffix: 'subdominant' };
        if (num === '5') return { name: 'Dominant', classSuffix: 'dominant' };
        return { name: 'Scale Note', classSuffix: 'note' };
    } else {
        if (num === '1') return { name: 'Root', classSuffix: 'root' };
        if (num === '3') return { name: '3rd', classSuffix: 'third' };
        if (num === '5') return { name: '5th', classSuffix: 'fifth' };
        if (num === '7') return { name: '7th', classSuffix: 'seventh' };
        return { name: `Extension (${interval})`, classSuffix: 'extension' };
    }
}

function previewItem(type, name) {
    // Toggle off if clicking the already active item
    if (currentPreview && currentPreview.name === name) {
        currentPreview = null;
    } else {
        let data = type === 'scale' ? Tonal.Scale.get(name) : Tonal.Chord.get(name);
        currentPreview = { type, name, data };
    }
    renderKeyboard(); // Re-render to show colors
    renderLegend();

    // Highlight the active result item in the list visually
    document.querySelectorAll('.result-item').forEach(el => el.classList.remove('active-preview'));
    if (currentPreview) {
        let activeEl = Array.from(document.querySelectorAll('.result-item'))
            .find(el => el.querySelector('.result-name').innerText === name);
        if (activeEl) activeEl.classList.add('active-preview');
    }
}

function renderLegend() {
    const container = document.getElementById('legend-container');
    if (!currentPreview) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'flex';
    const isScale = currentPreview.type === 'scale';

    const roles = isScale ? [
        { name: 'Tonic (1)', color: 'var(--color-tonic)' },
        { name: 'Subdominant (4)', color: 'var(--color-subdominant)' },
        { name: 'Dominant (5)', color: 'var(--color-dominant)' },
        { name: 'Scale Note', color: 'var(--color-scale-note)' }
    ] : [
        { name: 'Root (1)', color: 'var(--color-root)' },
        { name: '3rd', color: 'var(--color-third)' },
        { name: '5th', color: 'var(--color-fifth)' },
        { name: '7th', color: 'var(--color-seventh)' },
        { name: 'Extensions (9/11/13)', color: 'var(--color-extension)' }
    ];

    container.innerHTML = roles.map(r => `
        <div class="legend-item">
            <span class="legend-color" style="background: ${r.color}"></span>
            <span>${r.name}</span>
        </div>
    `).join('');
}

// --- INITIALIZATION ---
window.onload = () => {
    initAudio();
    renderKeyboard();
    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
    } else {
        document.getElementById('midi-select').innerHTML = '<option value="">Web MIDI API not supported</option>';
        // Listen for the retry option click
        document.getElementById('midi-select').addEventListener('change', (e) => {
            if (e.target.value === "retry") {
                // Re-request access on user interaction to wake up the MIDI subsystem
                navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
            } else {
                selectMidiInput(e.target.value);
            }
        });
    }
};
