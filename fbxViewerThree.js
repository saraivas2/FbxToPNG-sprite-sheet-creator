// fbxViewerThree.js - VERSÃO FINAL E CORRIGIDA (2024-06-05)
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- ELEMENTOS DO DOM ---
const renderCanvas = document.getElementById('renderCanvas');
const characterUpload = document.getElementById('characterUpload');
const animationList = document.getElementById('animationList');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const statusMessage = document.getElementById('statusMessage');
const keyboardHint = document.getElementById('keyboardHint');
const framesInput = document.getElementById('framesInput');
const columnsInput = document.getElementById('columnsInput');
const cellWidthInput = document.getElementById('cellWidthInput');
const cellHeightInput = document.getElementById('cellHeightInput');
const optimizeInput = document.getElementById('optimizeInput');
const recordBtn = document.getElementById('recordBtn');

// --- VARIÁVEIS GLOBAIS ---
let scene, camera, renderer, orbitControls, clock, mixer, currentModel, animationActions = [], currentAction;
let orthoCamera, orthoZoomFactor = 2.0, cameraOffsetX = 0, cameraOffsetY = 0, cameraAdjustStep = 0.25;
let boxHelper, axesHelper, gridHelper;
let isPreviewingOrtho = false;
let orthoCameraFrustumHelper;
let previewButton;
let isRecording = false;
let uploadedTextures = { map: null, normalMap: null };
let originalMaterials = new Map();

const captureCanvas = document.createElement('canvas');
const captureContext = captureCanvas.getContext('2d');

const angleDescriptions = {
    0: "S", 45: "SW", 90: "W", 135: "NW",
    180: "N", 225: "NE", 270: "E", 315: "SE",
    null: "CurrentView"
};

// --- INICIALIZAÇÃO ---
init();

function init() {
    scene = new THREE.Scene();
    scene.background = null;

    axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);
    gridHelper = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
    scene.add(gridHelper);

    renderer = new THREE.WebGLRenderer({ canvas: renderCanvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    clock = new THREE.Clock();

    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
    camera.position.set(0, 1.5, 5);
    scene.add(camera);

    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.target.set(0, 0.9, 0);
    orbitControls.enableDamping = true;

    orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2000);
    orthoCamera.position.set(0, 1, 10);
    orthoCamera.lookAt(0, 1, 0);
    scene.add(orthoCamera);

    orthoCameraFrustumHelper = new THREE.CameraHelper(orthoCamera);
    orthoCameraFrustumHelper.visible = false;
    scene.add(orthoCameraFrustumHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
    directionalLight.position.set(3, 5, 4);
    scene.add(directionalLight);
    
    const spriteSheetPanelDiv = document.getElementById('spriteSheetPanel');
    if (spriteSheetPanelDiv && !document.getElementById('captureIsometricToggle')) {
        const isoDiv = document.createElement('div');
        isoDiv.style.cssText = "display: flex; align-items: center; margin-top: 10px;";
        const isoCheckbox = document.createElement('input');
        isoCheckbox.type = 'checkbox';
        isoCheckbox.id = 'captureIsometricToggle';
        isoCheckbox.style.cssText = "width: auto; margin-right: 5px;";
        isoDiv.appendChild(isoCheckbox);
        const isoLabel = document.createElement('label');
        isoLabel.htmlFor = 'captureIsometricToggle';
        isoLabel.textContent = 'Capture 8 Isometric Angles';
        isoLabel.style.cssText = "font-size:11px; margin-top:0; display:inline;";
        isoDiv.appendChild(isoLabel);
        spriteSheetPanelDiv.appendChild(isoDiv);

        previewButton = document.createElement('button');
        previewButton.textContent = "Preview Sprite Cam";
        previewButton.style.marginTop = "10px";
        previewButton.onclick = toggleOrthoPreview;
        spriteSheetPanelDiv.appendChild(previewButton);
    }

    const diffuseUpload = document.getElementById('diffuseUpload');
    const normalUpload = document.getElementById('normalUpload');
    if (diffuseUpload) diffuseUpload.addEventListener('change', (e) => handleTextureUpload(e, 'map'));
    if (normalUpload) normalUpload.addEventListener('change', (e) => handleTextureUpload(e, 'normalMap'));
    
    characterUpload.addEventListener('change', handleFileSelect);
    playBtn.addEventListener('click', playSelectedAnimation);
    pauseBtn.addEventListener('click', togglePauseCurrentAnimation);
    animationList.addEventListener('change', onAnimationSelectionChange);
    recordBtn.addEventListener('click', startSpriteSheetRecording);
    window.addEventListener('resize', onWindowResize);

    createCameraControlsUI();
    onWindowResize();
    updateOrthoCameraView();

    showStatus("Three.js initialized. Load a GLB or FBX file.", "info");
    updateKeyboardHint(false);
    animate();
}

function toggleOrthoPreview() {
    isPreviewingOrtho = !isPreviewingOrtho;
    previewButton.textContent = isPreviewingOrtho ? "Exit Sprite Cam Preview" : "Preview Sprite Cam";
    orbitControls.enabled = !isPreviewingOrtho;
    orthoCameraFrustumHelper.visible = isPreviewingOrtho;
    updateKeyboardHint(isPreviewingOrtho);

    if (isPreviewingOrtho) {
        if (currentAction) {
            if (currentAction.paused) currentAction.paused = false;
            if (!currentAction.isRunning()) currentAction.play();
        }
        resetCameraPositionSprite();
    }
}

function updateKeyboardHint(isSpriteModeActive) {
    keyboardHint.textContent = isSpriteModeActive ?
        "Sprite Cam: Arrows/WASD (Move) | +/- (Zoom) | Home (Reset)" :
        "Orbit Cam: Mouse Drag | Zoom: Scroll | Pan: Right-Click Drag";
}

function showStatus(message, type = "info") {
    statusMessage.textContent = message;
    statusMessage.className = type;
    if (type === "error") console.error(message); else console.log(message);
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) { showStatus("No file selected.", "info"); return; }
    showStatus(`Loading ${file.name}...`);

    if (currentModel) scene.remove(currentModel);
    if (boxHelper) scene.remove(boxHelper);
    if (mixer) mixer.stopAllAction();
    currentModel = null; boxHelper = null; mixer = null;
    animationActions = []; animationList.innerHTML = ''; currentAction = null;
    uploadedTextures = { map: null, normalMap: null };
    originalMaterials.clear(); // Limpa os materiais antigos

    const objectURL = URL.createObjectURL(file);
    const extension = file.name.split('.').pop().toLowerCase();
    
    const loader = (extension === 'glb' || extension === 'gltf') ? new GLTFLoader() : new FBXLoader();

    loader.load(objectURL, (loadedObject) => {
        URL.revokeObjectURL(objectURL);

        const modelNode = (loadedObject.scene) ? loadedObject.scene : loadedObject;
        const animations = (loadedObject.animations) ? loadedObject.animations : [];

        // ANTES de adicionar à cena, guardamos os materiais originais
        modelNode.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => {
                    if (!originalMaterials.has(material.name)) {
                        console.log(`Storing original material: '${material.name}'`);
                        originalMaterials.set(material.name, material);
                    }
                });
            }
        });

        currentModel = new THREE.Group();
        scene.add(currentModel);

        const originalBox = new THREE.Box3().setFromObject(modelNode);
        const originalSize = originalBox.getSize(new THREE.Vector3());
        const originalCenter = originalBox.getCenter(new THREE.Vector3());
        
        modelNode.position.sub(originalCenter);
        currentModel.add(modelNode);

        const desiredHeight = 1.8;
        let scaleFactor = 1.0;
        if (originalSize.y > 0.01) {
            scaleFactor = desiredHeight / originalSize.y;
        } else {
            const maxDimOther = Math.max(originalSize.x, originalSize.z);
            if (maxDimOther > 0.01) scaleFactor = desiredHeight / maxDimOther;
        }
        if (isNaN(scaleFactor) || !isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 1;
        currentModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
        
        currentModel.updateMatrixWorld(true);
        if (boxHelper) scene.remove(boxHelper);
        boxHelper = new THREE.BoxHelper(currentModel, 0xffff00);
        scene.add(boxHelper);
        
        const worldBox = new THREE.Box3().setFromObject(currentModel);
        const worldCenter = worldBox.getCenter(new THREE.Vector3());
        const worldSize = worldBox.getSize(new THREE.Vector3());
        
        if (worldSize.lengthSq() > 0.0001) {
            const maxDim = Math.max(worldSize.x, worldSize.y, worldSize.z);
            const fov = camera.fov * (Math.PI / 180);
            let camDist = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
            camDist *= 2.0;
            camera.position.set(worldCenter.x, worldCenter.y + worldSize.y * 0.2, worldCenter.z + camDist);
            orbitControls.target.copy(worldCenter);
        }
        camera.lookAt(orbitControls.target);
        orbitControls.update();
        
        mixer = new THREE.AnimationMixer(modelNode);
        populateAnimationList(animations);
        showStatus(`${file.name} loaded. Animations: ${animations.length}.`, "info");
        if (animations.length > 0) playSelectedAnimation();
        
        resetCameraPositionSprite();
    },
    (xhr) => { if (xhr.lengthComputable) showStatus(`Loading ${file.name}: ${Math.round(xhr.loaded / xhr.total * 100)}%`); },
    (error) => { URL.revokeObjectURL(objectURL); console.error("Error loading model:", error); showStatus(`Error loading ${file.name}: ${error.message || 'Unknown error'}`, "error"); }
    );
}

function populateAnimationList(animations) {
    animationList.innerHTML = '';
    animationActions = [];
    animations.forEach((clip, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.text = clip.name || `Animation ${index + 1}`;
        animationList.appendChild(option);
        animationActions.push(mixer.clipAction(clip));
    });
    if (animationActions.length > 0) {
        animationList.selectedIndex = 0;
        currentAction = animationActions[0];
    }
}

function playSelectedAnimation() {
    if (!mixer || animationActions.length === 0) return;
    const selectedIndex = parseInt(animationList.value);
    if (selectedIndex < 0 || selectedIndex >= animationActions.length) return;
    const actionToPlay = animationActions[selectedIndex];
    if (currentAction === actionToPlay && currentAction.isRunning() && !currentAction.paused) return;
    if (currentAction) currentAction.fadeOut(0.3);
    actionToPlay.reset().setEffectiveWeight(1).fadeIn(0.3).play();
    actionToPlay.paused = false;
    currentAction = actionToPlay;
    showStatus(`Playing: ${currentAction.getClip().name}`, "info");
}

function onAnimationSelectionChange() { playSelectedAnimation(); }

function togglePauseCurrentAnimation() {
    if (currentAction) {
        currentAction.paused = !currentAction.paused;
        showStatus(currentAction.paused ? `Paused: ${currentAction.getClip().name}` : `Resumed: ${currentAction.getClip().name}`, "info");
    }
}

// SUBSTITUA ESTA FUNÇÃO NO SEU SCRIPT
function handleTextureUpload(event, mapType) {
    const file = event.target.files[0];
    if (!file) return;

    if (!currentModel) {
        showStatus("Please load a model first.", "error");
        event.target.value = ''; // Limpa o input de arquivo se não houver modelo
        return;
    }

    showStatus(`Loading ${mapType} texture...`, "info");
    const objectURL = URL.createObjectURL(file);
    const loader = new THREE.ImageLoader();

    // Carrega a imagem que o usuário selecionou
    loader.load(objectURL,
        (image) => { // Callback de sucesso retorna o elemento HTMLImageElement
            console.log(`Image data for ${mapType} loaded.`);
            let applied = false;
            
            // Percorre o modelo carregado na cena
            currentModel.traverse((child) => {
                if (child.isMesh && child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    
                    materials.forEach(material => {
                        console.log(`Checking material '${material.name || 'unnamed'}' for mapType '${mapType}'.`);
                        
                        // O "TRANSPLANTE DE IMAGEM":
                        // Se o material já tem um slot para este tipo de textura (ex: material.map),
                        // nós atualizamos a propriedade .image daquele objeto de textura existente.
                        // Isso preserva TODAS as outras configurações de UV (repeat, offset, rotation, wrap)
                        // que o FBXLoader ou GLTFLoader podem ter configurado.
                        if (material[mapType] && material[mapType].isTexture) {
                            console.log(`Updating existing texture object on material '${material.name}'.`);
                            material[mapType].image = image;
                            material[mapType].needsUpdate = true; // Crucial para o Three.js atualizar a textura na GPU
                        } else {
                            // Se, por algum motivo, não havia um slot de textura, criamos um novo.
                            // Este é um fallback. A maioria dos modelos já terá o slot.
                            console.log(`Creating new texture object on material '${material.name}'.`);
                            const newTexture = new THREE.Texture(image);
                            newTexture.flipY = false; // Nosso padrão seguro
                            material[mapType] = newTexture;
                            newTexture.needsUpdate = true;
                        }

                        // Garante que a cor base do material seja branca para não tingir a textura.
                        if (mapType === 'map') {
                            material.color.set(0xffffff);
                        }
                        
                        material.needsUpdate = true;
                        applied = true;
                    });
                }
            });

            showStatus(applied ? `${mapType} texture applied successfully.` : `Could not find a material to apply the ${mapType} texture to.`, applied ? "info" : "warn");
            event.target.value = ''; // Limpa o input de arquivo para permitir recarregar o mesmo arquivo
            URL.revokeObjectURL(objectURL);
        },
        undefined, 
        (err) => { 
            console.error(`Error loading image data for ${mapType}:`, err);
            showStatus(`Error loading ${mapType} image data.`, 'error');
            event.target.value = '';
            URL.revokeObjectURL(objectURL);
        }
    );
}
// ESTA FUNÇÃO É A CHAVE DA CORREÇÃO
function applyTexturesToModel(modelNode, texturesObject) {
    if (!modelNode || !texturesObject) return;
    console.log("Applying texture set:", texturesObject);

    modelNode.traverse((child) => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];

            materials.forEach(currentMaterial => {
                // Encontra o material original correspondente que guardamos
                const originalMaterial = originalMaterials.get(currentMaterial.name);
                if (!originalMaterial) {
                    console.warn(`Could not find original material for '${currentMaterial.name}'`);
                    return; // Pula se não encontrar o material original
                }

                // Aplica as texturas carregadas pelo usuário ao material atual
                for (const mapType in texturesObject) {
                    const userTexture = texturesObject[mapType];
                    if (userTexture) {
                        // O "transplante" final:
                        // Pega a textura vazia do material original (que tem as transformações de UV corretas)
                        // e coloca a imagem do usuário nela.
                        const targetTexture = originalMaterial[mapType];
                        if (targetTexture && targetTexture.isTexture) {
                            console.log(`Updating texture '${mapType}' on material '${currentMaterial.name}'.`);
                            targetTexture.image = userTexture.image;
                            targetTexture.needsUpdate = true;
                            currentMaterial[mapType] = targetTexture;
                        } else {
                            // Se o material original não tinha um slot de textura, usamos a nossa.
                            currentMaterial[mapType] = userTexture;
                        }

                        if (mapType === 'map') {
                            currentMaterial.color.set(0xffffff);
                        }
                        currentMaterial.needsUpdate = true;
                    }
                }
            });
        }
    });
}

function onWindowResize() {
    const container = renderCanvas.parentElement;
    if (!container) return;
    const size = Math.min(container.clientWidth, container.clientHeight);
    if (size === 0) return;

    if(renderer) renderer.setSize(size, size);
    if(camera) {
        camera.aspect = 1;
        camera.updateProjectionMatrix();
    }
    updateOrthoCameraView();
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (mixer && !isRecording) mixer.update(delta);

    const activeCamera = (isPreviewingOrtho || isRecording) ? orthoCamera : camera;
    
    if(activeCamera === orthoCamera) {
        if (orbitControls) orbitControls.enabled = false;
        if (orthoCameraFrustumHelper?.visible) orthoCameraFrustumHelper.update();
    } else {
        if (orbitControls) {
             orbitControls.enabled = true;
             orbitControls.update();
        }
    }
    if (renderer && scene && activeCamera) renderer.render(scene, activeCamera);
}

function updateOrthoCameraView() {
    if (!orthoCamera) return;

    const modelHeight = currentModel ? 1.8 : 1.8;
    const targetY = modelHeight / 2 + cameraOffsetY;
    const targetX = cameraOffsetX;
    
    orthoCamera.left = -orthoZoomFactor;
    orthoCamera.right = orthoZoomFactor;
    orthoCamera.top = orthoZoomFactor;
    orthoCamera.bottom = -orthoZoomFactor;
    
    orthoCamera.position.set(targetX, targetY, 10);
    orthoCamera.lookAt(targetX, targetY, 0);
    orthoCamera.updateProjectionMatrix();
    if (orthoCameraFrustumHelper?.visible) orthoCameraFrustumHelper.update();
}

function adjustCameraPositionSprite(directionX, directionY) {
    cameraOffsetX += directionX * cameraAdjustStep;
    cameraOffsetY += directionY * cameraAdjustStep;
    updateOrthoCameraView();
}

function resetCameraPositionSprite() {
    cameraOffsetX = 0;
    cameraOffsetY = 0;
    orthoZoomFactor = currentModel ? 1.5 : 2.5;
    updateOrthoCameraView();
    showStatus("Sprite camera position and zoom reset.", "info");
}

function createCameraControlsUI() {
    let panel = document.getElementById('cameraControlPanel');
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'cameraControlPanel';
    panel.style.cssText = `
        position: absolute; left: 10px; top: 10px;
        background-color: rgba(0,0,0,0.75); border-radius: 8px;
        padding: 10px; color: white; z-index: 101;
        font-family: Arial, sans-serif; display: flex;
        flex-direction: column; align-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = 'Sprite Cam Adjust';
    title.style.cssText = 'margin-bottom: 8px; font-weight: bold; font-size: 13px; border-bottom: 1px solid #555; padding-bottom: 5px; width: 100%; text-align: center;';
    panel.appendChild(title);
    
    const controlGrid = document.createElement('div');
    controlGrid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 36px); grid-template-rows: repeat(3, 36px); gap: 4px; margin-bottom: 8px;';
    const btnStyleBase = 'width:100%; height:100%; background-color:#4F4F4F; border:1px solid #333; color:white; cursor:pointer; border-radius:5px; font-weight:bold; display:flex; align-items:center; justify-content:center; transition: background-color 0.2s;';
    const btnHoverStyle = 'background-color: #6A6A6A;';
    const btnMouseOutStyle = 'background-color: #4F4F4F;';

    const btnData = [
        { html: '↖', title: 'Move Up-Left', action: () => { adjustCameraPositionSprite(-1, 1); }},
        { html: '▲', title: 'Move Up (W)', action: () => adjustCameraPositionSprite(0, 1) },
        { html: '↗', title: 'Move Up-Right', action: () => { adjustCameraPositionSprite(1, 1); }},
        { html: '◀', title: 'Move Left (A)', action: () => adjustCameraPositionSprite(-1, 0) },
        { html: '⌂', title: 'Reset View (Home)', action: resetCameraPositionSprite },
        { html: '▶', title: 'Move Right (D)', action: () => adjustCameraPositionSprite(1, 0) },
        { html: '↙', title: 'Move Down-Left', action: () => { adjustCameraPositionSprite(-1, -1); }},
        { html: '▼', title: 'Move Down (S)', action: () => adjustCameraPositionSprite(0, -1) },
        { html: '↘', title: 'Move Down-Right', action: () => { adjustCameraPositionSprite(1, -1); }}
    ];

    btnData.forEach(data => {
        const btn = document.createElement('button');
        btn.innerHTML = data.html;
        btn.style.cssText = btnStyleBase;
        if (data.title) btn.title = data.title;
        if (data.action) {
            btn.onclick = data.action;
            btn.onmouseenter = () => btn.style.backgroundColor = '#6A6A6A';
            btn.onmouseleave = () => btn.style.backgroundColor = '#4F4F4F';
        }
        controlGrid.appendChild(btn);
    });
    panel.appendChild(controlGrid);
    
    const zoomDiv = document.createElement('div');
    zoomDiv.style.cssText = 'display: flex; justify-content: space-between; width: 100%; margin-bottom: 8px;';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    zoomOutBtn.title = "Zoom Out (-)";
    zoomOutBtn.style.cssText = btnStyleBase + " flex:1; margin-right:2px; padding: 5px;";
    zoomOutBtn.onclick = () => { orthoZoomFactor = Math.min(20, orthoZoomFactor * 1.15); updateOrthoCameraView(); };
    zoomOutBtn.onmouseenter = () => zoomOutBtn.style.backgroundColor = '#6A6A6A';
    zoomOutBtn.onmouseleave = () => zoomOutBtn.style.backgroundColor = '#4F4F4F';
    zoomDiv.appendChild(zoomOutBtn);

    const zoomInBtn = document.createElement('button');
    zoomInBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    zoomInBtn.title = "Zoom In (+)";
    zoomInBtn.style.cssText = btnStyleBase + " flex:1; margin-left:2px; padding: 5px;";
    zoomInBtn.onclick = () => { orthoZoomFactor = Math.max(0.1, orthoZoomFactor * 0.85); updateOrthoCameraView(); };
    zoomInBtn.onmouseenter = () => zoomInBtn.style.backgroundColor = '#6A6A6A';
    zoomInBtn.onmouseleave = () => zoomInBtn.style.backgroundColor = '#4F4F4F';
    zoomDiv.appendChild(zoomInBtn);
    panel.appendChild(zoomDiv);

    const stepControl = document.createElement('div');
    stepControl.style.cssText = 'margin-top: 5px; width: 100%; text-align: center;';
    const stepLabel = document.createElement('label');
    stepLabel.textContent = 'Pan Step:';
    stepLabel.style.cssText = 'display: block; font-size: 11px; margin-bottom: 2px;';
    stepControl.appendChild(stepLabel);
    const stepSelect = document.createElement('select');
    stepSelect.title = "Pan/Move Step Size";
    stepSelect.style.cssText = 'width: 100%; background-color: #333; color: white; border: 1px solid #555; border-radius: 4px; padding: 4px; font-size: 11px;';
    [0.05, 0.1, 0.25, 0.5, 1.0].forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val.toFixed(2);
        if (val === cameraAdjustStep) opt.selected = true;
        stepSelect.appendChild(opt);
    });
    stepSelect.onchange = (e) => { cameraAdjustStep = parseFloat(e.target.value); showStatus(`Sprite cam pan step: ${cameraAdjustStep.toFixed(2)}`); };
    stepControl.appendChild(stepSelect);
    panel.appendChild(stepControl);

    document.addEventListener('keydown', (e) => {
        const isTyping = ['input', 'select', 'textarea'].includes(document.activeElement.tagName.toLowerCase());
        if (!isPreviewingOrtho || isRecording || isTyping) return;
        let handled = true;
        switch(e.key.toLowerCase()) {
            case 'arrowup': case 'w': adjustCameraPositionSprite(0, 1); break;
            case 'arrowdown': case 's': adjustCameraPositionSprite(0, -1); break;
            case 'arrowleft': case 'a': adjustCameraPositionSprite(-1, 0); break;
            case 'arrowright': case 'd': adjustCameraPositionSprite(1, 0); break;
            case 'home': resetCameraPositionSprite(); break;
            case '+': case '=': orthoZoomFactor = Math.max(0.1, orthoZoomFactor * 0.85); updateOrthoCameraView(); break;
            case '-': case '_': orthoZoomFactor = Math.min(20, orthoZoomFactor * 1.15); updateOrthoCameraView(); break;
            default: handled = false;
        }
        if (handled) e.preventDefault();
    });
}

async function startSpriteSheetRecording() {
    if (!currentModel || !mixer || !currentAction) {
        showStatus("Load a model and select an animation first.", "error"); return;
    }
    if (isRecording) {
        showStatus("Recording already in progress.", "error"); return;
    }

    isRecording = true;
    recordBtn.disabled = true; recordBtn.textContent = "Recording...";
    if (isPreviewingOrtho) toggleOrthoPreview();

    if (axesHelper) axesHelper.visible = false;
    if (gridHelper) gridHelper.visible = false;
    if (boxHelper) boxHelper.visible = false;
    if (orthoCameraFrustumHelper) orthoCameraFrustumHelper.visible = false;

    renderer.setClearColor(0x000000, 0); scene.background = null;
    const originalOrbitControlsEnabled = orbitControls.enabled;
    orbitControls.enabled = false;

    const baseAnimName = currentAction.getClip().name;
    let anglesToCapture = [null];
    const isometricToggle = document.getElementById('captureIsometricToggle');
    if (isometricToggle && isometricToggle.checked) {
        anglesToCapture = [0, 45, 90, 135, 180, 225, 270, 315];
    } else{
         anglesToCapture = [90,-90];
    }

    const previewCameraPosition = orthoCamera.position.clone();
    const previewZoomFactor = orthoZoomFactor;
    const previewCameraOffsetX = cameraOffsetX;
    const previewCameraOffsetY = cameraOffsetY;
    const modelHeight = 1.8;
    const orbitPivotPoint = new THREE.Vector3(previewCameraOffsetX, modelHeight / 2 + previewCameraOffsetY, 0);
    const initialCamVectorToPivot = new THREE.Vector3().subVectors(previewCameraPosition, orbitPivotPoint);
    const orbitDistance = new THREE.Vector3(initialCamVectorToPivot.x, 0, initialCamVectorToPivot.z).length() || 10;
    const orbitHeightOffset = initialCamVectorToPivot.y;

    for (let i = 0; i < anglesToCapture.length; i++) {
        const angleDeg = anglesToCapture[i];
        const angleName = angleDescriptions[angleDeg] || `angle${angleDeg}`;
        
        if (angleDeg !== null) {
            const angleRad = THREE.MathUtils.degToRad(angleDeg);
            orthoCamera.position.x = orbitPivotPoint.x + orbitDistance * Math.sin(angleRad);
            orthoCamera.position.z = orbitPivotPoint.z + orbitDistance * Math.cos(angleRad);
            orthoCamera.position.y = orbitPivotPoint.y + orbitHeightOffset;
            orthoCamera.lookAt(orbitPivotPoint);
            orthoZoomFactor = previewZoomFactor;
            orthoCamera.updateProjectionMatrix();
            if (orthoCameraFrustumHelper) orthoCameraFrustumHelper.update();
        }

        const filenameForSheet = (baseAnimName.replace(/[^\w-]/g, '_') || 'spritesheet') + (anglesToCapture.length > 1 ? `_${angleName}` : '');
        
        try {
            await captureAndGenerateSheetForAngle(filenameForSheet, anglesToCapture.length, i);
            showStatus(`Angle ${angleName} captured for ${baseAnimName}.`, "info");
        } catch (error) {
            showStatus(`Error capturing angle ${angleName}: ${error ? error.message : 'Unknown error'}`, "error");
            console.error(`Error details for angle ${angleName}:`, error);
        }
    }

    // Restaurar UI e estado da câmera
    if (axesHelper) axesHelper.visible = true;
    if (gridHelper) gridHelper.visible = true;
    if (boxHelper && currentModel) boxHelper.visible = true;

    recordBtn.disabled = false; recordBtn.textContent = "Record Sprite Sheet";
    isRecording = false;
    orbitControls.enabled = originalOrbitControlsEnabled;

    orthoCamera.position.copy(previewCameraPosition);
    const originalLookAtTarget = new THREE.Vector3(previewCameraOffsetX, modelHeight/2 + previewCameraOffsetY, 0);
    orthoCamera.lookAt(originalLookAtTarget);
    orthoZoomFactor = previewZoomFactor;
    cameraOffsetX = previewCameraOffsetX;
    cameraOffsetY = previewCameraOffsetY;
    updateOrthoCameraView();

    if (currentAction && !isPreviewingOrtho) {
        currentAction.paused = false;
        if (!currentAction.isRunning()) currentAction.play();
    }
    showStatus("All sprite sheets captured!", "info");
}


function captureAndGenerateSheetForAngle(filenameForSheet, totalAnglesParam, currentIndexParam) {
    return new Promise((resolve, reject) => {
        let localRecordedFrames = [];
        let localCurrentFrameBeingCaptured = 0;
        let localFrameCountToCapture = parseInt(framesInput.value);
        if (isNaN(localFrameCountToCapture) || localFrameCountToCapture <= 0) localFrameCountToCapture = 16;
        
        if (!currentAction || !currentAction.getClip()) {
            return reject(new Error("No current animation clip for angle capture."));
        }
        const localAnimationDuration = currentAction.getClip().duration; 

        console.log(`[INIT ANGLE CAPTURE] For ${filenameForSheet}. Duration: ${localAnimationDuration.toFixed(4)}s, Frames: ${localFrameCountToCapture}`);
        showStatus(`Recording ${filenameForSheet} (Angle ${currentIndexParam + 1}/${totalAnglesParam}): Frame 0/${localFrameCountToCapture}`, "info");

        if (localAnimationDuration <= 0) {
            showStatus(`Warning: Animation for ${filenameForSheet} has zero duration. Skipping.`, "error");
            return resolve(); 
        }

        currentAction.stop();
        currentAction.play();
        currentAction.paused = true;
        if (currentAction) currentAction.time = 0; 
        else return reject(new Error("currentAction is null."));
        mixer.update(0.00001);

        function _captureSingleFrameInternalRecursive() {
            if (localCurrentFrameBeingCaptured >= localFrameCountToCapture) {
                console.log(`[HOOK] All ${localFrameCountToCapture} frames for ${filenameForSheet} collected. Generating.`);
                if (localRecordedFrames.length > 0) generateSpriteSheetImage(filenameForSheet, localRecordedFrames);
                resolve();
                return;
            }

            const timeRatio = (localFrameCountToCapture > 1) ? (localCurrentFrameBeingCaptured / (localFrameCountToCapture - 1)) : 0;
            const timeAtFrame = timeRatio * localAnimationDuration;

            if (currentAction) currentAction.time = timeAtFrame;
            else return reject(new Error("currentAction is null mid-capture."));

            requestAnimationFrame(() => {
                mixer.update(0.00001);
                if (currentModel) currentModel.updateMatrixWorld(true);
                else return reject(new Error("currentModel is null mid-capture."));
        
                requestAnimationFrame(() => { 
                    const cellW = parseInt(cellWidthInput.value);
                    const cellH = parseInt(cellHeightInput.value);
                    const originalRendererSize = new THREE.Vector2();
                    renderer.getSize(originalRendererSize);
                    const originalOrthoParams = { left: orthoCamera.left, right: orthoCamera.right, top: orthoCamera.top, bottom: orthoCamera.bottom };
            
                    renderer.setSize(cellW, cellH); 
                    const cellAspect = cellW / cellH;
                    orthoCamera.left = -orthoZoomFactor * cellAspect;
                    orthoCamera.right = orthoZoomFactor * cellAspect;
                    orthoCamera.top = orthoZoomFactor;    
                    orthoCamera.bottom = -orthoZoomFactor; 
                    orthoCamera.updateProjectionMatrix();
            
                    renderer.render(scene, orthoCamera);
                    const dataURL = renderer.domElement.toDataURL('image/png');
                    const img = new Image();
                    img.onload = () => {
                        localRecordedFrames.push(img);
                        localCurrentFrameBeingCaptured++;
                        showStatus(`Recording ${filenameForSheet} (Angle ${currentIndexParam + 1}/${totalAnglesParam}): Frame ${localCurrentFrameBeingCaptured}/${localFrameCountToCapture}`, "info");

                        renderer.setSize(originalRendererSize.x, originalRendererSize.y);
                        orthoCamera.left = originalOrthoParams.left;
                        orthoCamera.right = originalOrthoParams.right;
                        orthoCamera.top = originalOrthoParams.top;
                        orthoCamera.bottom = originalOrthoParams.bottom;
                        orthoCamera.updateProjectionMatrix();
                        
                        setTimeout(_captureSingleFrameInternalRecursive, 100);
                    }; 
                    img.onerror = (err) => reject(new Error("img.onerror: " + (err ? String(err.message || err) : "unknown")));
                    img.src = dataURL;
                }); 
            }); 
        } 
        _captureSingleFrameInternalRecursive(); 
    }); 
}

// SUBSTITUA SUA FUNÇÃO generateSpriteSheetImage POR ESTA VERSÃO MAIS ROBUSTA
function generateSpriteSheetImage(filename, framesArrayToUse) {
    console.log(`[SPRITE GEN] Iniciando generateSpriteSheetImage para: ${filename} | Número de frames recebidos: ${framesArrayToUse.length}`);
    
    const numFrames = framesArrayToUse.length;
    if (numFrames === 0) {
        showStatus(`Nenhum frame no array para gerar a sprite sheet: ${filename}.`, "error");
        console.error(`[SPRITE GEN] Tentativa de gerar sprite sheet para ${filename} sem frames.`);
        return;
    }

    const numColumns = parseInt(columnsInput.value) || 4;
    const numRows = Math.ceil(numFrames / numColumns);
    const cellW = parseInt(cellWidthInput.value) || 480;
    const cellH = parseInt(cellHeightInput.value) || 480;
    const optimize = optimizeInput.checked;

    captureCanvas.width = cellW * numColumns;
    captureCanvas.height = cellH * numRows;
    captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    console.log(`[SPRITE GEN] Canvas da sprite sheet preparado: ${captureCanvas.width}x${captureCanvas.height}px para ${filename}`);

    for (let i = 0; i < numFrames; i++) {
        const frameImg = framesArrayToUse[i];
        if (!frameImg || !(frameImg instanceof HTMLImageElement) || !frameImg.complete || frameImg.naturalWidth === 0) {
            console.error(`[SPRITE GEN] Frame inválido ou não carregado no índice ${i} para ${filename}. Pulando.`);
            continue; 
        }
        const r = Math.floor(i / numColumns);
        const c = i % numColumns;
        const destX = c * cellW;
        const destY = r * cellH;

        if (optimize) { 
            const bounds = analyzeFrameContent(frameImg);
            
            // Adiciona checagem explícita para o objeto bounds e suas propriedades
            if (!bounds || typeof bounds.width === 'undefined' || typeof bounds.height === 'undefined' || typeof bounds.left === 'undefined' || typeof bounds.top === 'undefined') {
                console.error(`[SPRITE GEN] Bounds inválidos retornados por analyzeFrameContent para frame ${i} de ${filename}. Desenhando frame inteiro. Bounds:`, bounds);
                captureContext.drawImage(frameImg, 0, 0, frameImg.naturalWidth, frameImg.naturalHeight,
                                         destX, destY, cellW, cellH);
                continue; // Pula para o próximo frame
            }

            const drawW = bounds.width;
            const drawH = bounds.height;
            const offsetX = Math.floor((cellW - drawW) / 2);
            const offsetY = Math.floor((cellH - drawH) / 2);

            if (drawW <= 0 || drawH <= 0) {
                console.warn(`[SPRITE GEN] Dimensões de desenho calculadas são zero ou negativas para frame ${i} de ${filename} (drawW: ${drawW}, drawH: ${drawH}). Desenhando frame inteiro como fallback.`);
                captureContext.drawImage(frameImg, 0, 0, frameImg.naturalWidth, frameImg.naturalHeight,
                                         destX, destY, cellW, cellH);
            } else {
                captureContext.drawImage(frameImg,
                    bounds.left, bounds.top, drawW, drawH,
                    destX + offsetX, destY + offsetY, drawW, drawH);
            }
        } else {
            captureContext.drawImage(frameImg, 0, 0, frameImg.naturalWidth, frameImg.naturalHeight,
                                     destX, destY, cellW, cellH);
        }
    }

    const dataURL = captureCanvas.toDataURL('image/png');
    if (!dataURL || dataURL.length < 100) {
        console.error(`[SPRITE GEN] DataURL gerado para ${filename} é inválido ou muito curto.`);
        showStatus(`Erro ao gerar imagem da sprite sheet para ${filename}.`, "error");
        return;
    }
    console.log(`[SPRITE GEN] DataURL da sprite sheet final para ${filename} gerado (tamanho: ${dataURL.length}). Preparando download.`);
    
    const downloadLink = document.createElement('a');
    downloadLink.href = dataURL;
    downloadLink.download = `${filename}_${cellW}x${cellH}px_sheet.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    console.log(`[SPRITE GEN] Download da sprite sheet ${downloadLink.download} iniciado.`);

    const metadata = {
        frameWidth: cellW, frameHeight: cellH, frames: numFrames,
        columns: numColumns, rows: numRows,
        animationName: currentAction ? currentAction.getClip().name : "UnknownAnimation",
        angle: filename.includes("_angle") ? filename.substring(filename.lastIndexOf("_angle") + "_angle".length) : 
               (filename.includes("_CurrentView") ? "CurrentView" : "Default"),
        optimized: optimize, date: new Date().toISOString()
    };
    const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    const metadataLink = document.createElement('a');
    metadataLink.href = URL.createObjectURL(metadataBlob);
    metadataLink.download = `${filename}_metadata.json`;
    document.body.appendChild(metadataLink);
    metadataLink.click();
    document.body.removeChild(metadataLink);
    URL.revokeObjectURL(metadataLink.href);
    console.log(`[SPRITE GEN] Download do metadata ${metadataLink.download} iniciado.`);
}

function finishSpriteSheetRecording(hasError = false) {
    if (isRecording || (recordBtn && recordBtn.disabled)) {
        isRecording = false;
        if(recordBtn) {
            recordBtn.disabled = false;
            recordBtn.textContent = "Record Sprite Sheet";
        }
        if(orbitControls) orbitControls.enabled = !isPreviewingOrtho;
        updateKeyboardHint(isPreviewingOrtho);

        if (axesHelper) axesHelper.visible = true;
        if (gridHelper) gridHelper.visible = true;
        if (boxHelper && currentModel) boxHelper.visible = true;

        if (hasError) {
            showStatus("Sprite sheet recording process finished with an error.", "error");
        }
        if (currentAction && !isPreviewingOrtho) {
            currentAction.paused = false;
            if (!currentAction.isRunning()) currentAction.play();
        }
    }
}

// SUBSTITUA SUA FUNÇÃO analyzeFrameContent POR ESTA VERSÃO MAIS ROBUSTA
function analyzeFrameContent(frameImage) { 
    if (!frameImage || typeof frameImage.naturalWidth === 'undefined' || frameImage.naturalWidth === 0) {
        console.error("[ANALYZE CONTENT] frameImage inválido ou sem dimensões:", frameImage);
        // Retorna um bounds que cobre a célula inteira para não quebrar o drawImage
        const cellW = parseInt(cellWidthInput.value) || 256;
        const cellH = parseInt(cellHeightInput.value) || 256;
        return { left: 0, top: 0, width: cellW, height: cellH, error: true };
    }

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = frameImage.naturalWidth;
    tempCanvas.height = frameImage.naturalHeight;
    
    try {
        tempCtx.drawImage(frameImage, 0, 0); // Tenta desenhar a imagem
    } catch (e) {
        console.error("[ANALYZE CONTENT] Erro ao desenhar frameImage no canvas temporário:", e, frameImage.src.substring(0,60));
        const cellW = parseInt(cellWidthInput.value) || 256;
        const cellH = parseInt(cellHeightInput.value) || 256;
        return { left: 0, top: 0, width: cellW, height: cellH, error: true };
    }

    let pixelData;
    try {
        pixelData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
    } catch (e) {
        console.error("[ANALYZE CONTENT] Erro ao obter ImageData (imagem pode ser 'tainted' se de outra origem, mas aqui é dataURL):", e, frameImage.src.substring(0,60));
        const cellW = parseInt(cellWidthInput.value) || 256;
        const cellH = parseInt(cellHeightInput.value) || 256;
        return { left: 0, top: 0, width: cellW, height: cellH, error: true };
    }
    
    let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0;
    let foundContent = false;

    for (let y = 0; y < tempCanvas.height; y++) {
        for (let x = 0; x < tempCanvas.width; x++) {
            const alphaIndex = (y * tempCanvas.width + x) * 4 + 3;
            if (pixelData[alphaIndex] > 10) { // Alpha threshold
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                foundContent = true;
            }
        }
    }

    if (!foundContent) {
        console.warn("[ANALYZE CONTENT] Nenhum conteúdo encontrado (frame pode ser transparente). Usando dimensões originais.");
        return { left: 0, top: 0, width: frameImage.naturalWidth, height: frameImage.naturalHeight };
    }
    
    const margin = Math.ceil(Math.min(frameImage.naturalWidth, frameImage.naturalHeight) * 0.01); 
    minX = Math.max(0, minX - margin);
    minY = Math.max(0, minY - margin);
    maxX = Math.min(tempCanvas.width - 1, maxX + margin);
    maxY = Math.min(tempCtx.canvas.height - 1, maxY);

    return {
        left: minX, top: minY,
        width: Math.max(1, (maxX - minX + 1)), // Garante que width e height sejam pelo menos 1
        height: Math.max(1, (maxY - minY + 1)) 
    };
}


// --- Initialize ---
init();