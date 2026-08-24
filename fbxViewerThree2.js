// fbxViewerThree.js - VERSÃO COM SUPORTE ISOMÉTRICO ESTÁTICO
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
const rotXInput = document.getElementById('rotX');
const rotYInput = document.getElementById('rotY');
const rotZInput = document.getElementById('rotZ');
const resetRotBtn = document.getElementById('resetRotBtn');
const captureModeSelect = document.getElementById('captureModeSelect');

// --- VARIÁVEIS GLOBAIS ---
let scene, camera, renderer, orbitControls, clock, mixer, currentModel, animationActions = [], currentAction;
let orthoCamera, orthoZoomFactor = 2.0, cameraOffsetX = 0, cameraOffsetY = 0, cameraAdjustStep = 0.25;
let boxHelper, axesHelper, gridHelper;
let isPreviewingOrtho = false;
let orthoCameraFrustumHelper;
let previewButton;
let isRecording = false;
let originalMaterials = new Map();

const captureCanvas = document.createElement('canvas');
const captureContext = captureCanvas.getContext('2d');

const angleDescriptions = {
    0: "S", 45: "SW", 90: "W", 135: "NW",
    180: "N", 225: "NE", 270: "E", 315: "SE",
    null: "CurrentView"
};

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
    if (spriteSheetPanelDiv) {
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

    if(rotXInput) rotXInput.addEventListener('input', updateModelRotation);
    if(rotYInput) rotYInput.addEventListener('input', updateModelRotation);
    if(rotZInput) rotZInput.addEventListener('input', updateModelRotation);
    if(resetRotBtn) resetRotBtn.addEventListener('click', resetModelRotation);

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
    originalMaterials.clear();

    const objectURL = URL.createObjectURL(file);
    const extension = file.name.split('.').pop().toLowerCase();
    const loader = (extension === 'glb' || extension === 'gltf') ? new GLTFLoader() : new FBXLoader();

    loader.load(objectURL, (loadedObject) => {
        URL.revokeObjectURL(objectURL);

        const modelNode = (loadedObject.scene) ? loadedObject.scene : loadedObject;
        const animations = (loadedObject.animations) ? loadedObject.animations : [];

        // 1. Mapeamento robusto de múltiplos materiais
        modelNode.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    // Trata arrays de materiais (MultiMaterial) ou material único
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((material, index) => {
                        // Se o material não tiver nome, gera um baseado no índice
                        if (!material.name) material.name = `Material_${index + 1}`;
                        if (!originalMaterials.has(material.name)) {
                            originalMaterials.set(material.name, material);
                        }
                    });
                }
            }
        });

        // 2. Cria a interface customizada para os materiais encontrados
        buildMaterialsUI();

        currentModel = new THREE.Group();
        scene.add(currentModel);

        modelNode.position.set(0, 0, 0);
        modelNode.rotation.set(0, 0, 0);
        modelNode.scale.set(1, 1, 1);
        modelNode.updateMatrixWorld(true);

        const originalBox = new THREE.Box3().setFromObject(modelNode);
        const originalCenter = originalBox.getCenter(new THREE.Vector3());
        
        modelNode.position.x = -originalCenter.x;
        modelNode.position.z = -originalCenter.z;
        const feetOffset = originalBox.min.y;
        modelNode.position.y = -feetOffset;
        
        currentModel.add(modelNode);
        currentModel.updateMatrixWorld(true);
        
        const alignedBox = new THREE.Box3().setFromObject(currentModel);
        const alignedSize = alignedBox.getSize(new THREE.Vector3());
        
        const targetHeight = 2.5;
        const scaleFactor = targetHeight / (alignedSize.y || 1);
        currentModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
        currentModel.updateMatrixWorld(true);

        const finalBox = new THREE.Box3().setFromObject(currentModel);
        const finalMinY = finalBox.min.y;
        const finalHeight = finalBox.getSize(new THREE.Vector3()).y;
        
        if (Math.abs(finalMinY) > 0.001) {
            currentModel.position.y -= finalMinY;
            currentModel.updateMatrixWorld(true);
        }

        if (boxHelper) scene.remove(boxHelper);
        boxHelper = new THREE.BoxHelper(currentModel, 0xffff00);
        scene.add(boxHelper);

        camera.position.set(0, finalHeight * 0.5, finalHeight * 2);
        orbitControls.target.set(0, finalHeight * 0.5, 0);
        orbitControls.update();

        mixer = new THREE.AnimationMixer(modelNode);
        populateAnimationList(animations);
        
        if (animations.length === 0) {
            if (captureModeSelect) captureModeSelect.value = 'static';
            const animatedConfigSection = document.getElementById('animatedConfigSection');
            if (animatedConfigSection) animatedConfigSection.style.display = 'none';
            showStatus(`${file.name} loaded. Static mode active.`, "info");
        } else {
            if (captureModeSelect) captureModeSelect.value = 'animated';
            const animatedConfigSection = document.getElementById('animatedConfigSection');
            if (animatedConfigSection) animatedConfigSection.style.display = 'block';
            showStatus(`${file.name} loaded with animations.`, "info");
            playSelectedAnimation();
        }
        
        orthoZoomFactor = finalHeight * 0.6;
        resetCameraPositionSprite();
    },
    (xhr) => { if (xhr.lengthComputable) showStatus(`Loading: ${Math.round(xhr.loaded / xhr.total * 100)}%`); },
    (error) => { showStatus(`Error loading model.`, "error"); }
    );
}

function buildMaterialsUI() {
    const container = document.getElementById('materialsContainer');
    if (!container) return;
    container.innerHTML = ''; // Limpa a UI anterior

    if (originalMaterials.size === 0) {
        container.innerHTML = '<div style="font-size:11px; color:#aaa;">No materials found.</div>';
        return;
    }

    originalMaterials.forEach((material, matName) => {
        const matBlock = document.createElement('div');
        matBlock.style.cssText = "margin-bottom: 12px; padding: 6px; background: rgba(255,255,255,0.05); border-left: 3px solid #4CAF50; border-radius: 2px;";

        const title = document.createElement('div');
        title.textContent = matName;
        title.style.cssText = "font-size: 11px; font-weight: bold; margin-bottom: 4px; color: #ecf0f1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        matBlock.appendChild(title);

        // Grid para colocar os dois botões compactos lado a lado
        const buttonGrid = document.createElement('div');
        buttonGrid.style.cssText = "display: flex; gap: 4px;";

        // Configuração do Albedo (Diffuse Map)
        const diffLabel = document.createElement('label');
        diffLabel.textContent = "Albedo";
        diffLabel.style.cssText = "flex: 1; text-align: center; background: #3498db; padding: 4px 2px; font-size: 10px; border-radius: 3px; cursor: pointer;";
        const diffInput = document.createElement('input');
        diffInput.type = 'file';
        diffInput.accept = 'image/*';
        diffInput.style.display = 'none';
        diffInput.addEventListener('change', (e) => handleSpecificTextureUpload(e, matName, 'map'));
        diffLabel.appendChild(diffInput);
        buttonGrid.appendChild(diffLabel);

        // Configuração do Normal Map
        const normLabel = document.createElement('label');
        normLabel.textContent = "Normal";
        normLabel.style.cssText = "flex: 1; text-align: center; background: #9b59b6; padding: 4px 2px; font-size: 10px; border-radius: 3px; cursor: pointer;";
        const normInput = document.createElement('input');
        normInput.type = 'file';
        normInput.accept = 'image/*';
        normInput.style.display = 'none';
        normInput.addEventListener('change', (e) => handleSpecificTextureUpload(e, matName, 'normalMap'));
        normLabel.appendChild(normInput);
        buttonGrid.appendChild(normLabel);

        matBlock.appendChild(buttonGrid);
        container.appendChild(matBlock);
    });
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
}

function onAnimationSelectionChange() { playSelectedAnimation(); }

function togglePauseCurrentAnimation() {
    if (currentAction) {
        currentAction.paused = !currentAction.paused;
    }
}

function handleSpecificTextureUpload(event, targetMatName, mapType) {
    const file = event.target.files[0];
    if (!file) return;
    if (!currentModel) {
        showStatus("Please load a model first.", "error");
        return;
    }

    showStatus(`Uploading ${mapType} for ${targetMatName}...`, "info");
    const objectURL = URL.createObjectURL(file);
    const loader = new THREE.ImageLoader();

    loader.load(objectURL, (image) => {
        let applied = false;

        currentModel.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach(material => {
                    // Verifica se o nome do material bate exatamente com o alvo selecionado
                    if (material.name === targetMatName) {
                        if (material[mapType] && material[mapType].isTexture) {
                            material[mapType].image = image;
                            material[mapType].needsUpdate = true;
                        } else {
                            const newTexture = new THREE.Texture(image);
                            newTexture.flipY = false; // Compatibilidade padrão para FBX/GLTF
                            material[mapType] = newTexture;
                            newTexture.needsUpdate = true;
                        }
                        
                        if (mapType === 'map') {
                            material.color.set(0xffffff); // Evita distorção de cores se a base não for branca
                        }
                        material.needsUpdate = true;
                        applied = true;
                    }
                });
            }
        });

        if (applied) {
            showStatus(`Applied ${mapType} to ${targetMatName}!`, "info");
        } else {
            showStatus(`Material ${targetMatName} not found active in scene nodes.`, "error");
        }
        URL.revokeObjectURL(objectURL);
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
    
    if (mixer && !isRecording && captureModeSelect?.value === 'animated') {
        mixer.update(delta);
    }
    if (boxHelper && currentModel) boxHelper.update();

    const activeCamera = (isPreviewingOrtho || isRecording) ? orthoCamera : camera;
    
    if(activeCamera === orthoCamera) {
        if (orbitControls) orbitControls.enabled = false;
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
    orthoCamera.left = -orthoZoomFactor;
    orthoCamera.right = orthoZoomFactor;
    orthoCamera.top = orthoZoomFactor;
    orthoCamera.bottom = -orthoZoomFactor;
    orthoCamera.position.set(cameraOffsetX, cameraOffsetY, 10);
    orthoCamera.lookAt(cameraOffsetX, cameraOffsetY, 0);
    orthoCamera.updateProjectionMatrix();
}

function diagnoseSpriteCapture() {
    if (!currentModel) { showStatus("No model loaded.", "error"); return; }
    const box = new THREE.Box3().setFromObject(currentModel);
    const size = box.getSize(new THREE.Vector3());
    alert(`Model Height: ${size.y.toFixed(2)} | Width: ${size.x.toFixed(2)}`);
}

function adjustCameraPositionSprite(directionX, directionY) {
    cameraOffsetX += directionX * cameraAdjustStep;
    cameraOffsetY += directionY * cameraAdjustStep;
    updateOrthoCameraView();
}

function resetCameraPositionSprite() {
    cameraOffsetX = 0;
    if (currentModel) {
        const box = new THREE.Box3().setFromObject(currentModel);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        orthoZoomFactor = Math.max(1.2, Math.max(size.x, size.y, size.z) * 0.6);
        cameraOffsetY = center.y;
    } else {
        orthoZoomFactor = 2.5;
        cameraOffsetY = 0;
    }
    updateOrthoCameraView();
}

function createCameraControlsUI() {
    let panel = document.getElementById('cameraControlPanel');
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'cameraControlPanel';
    panel.style.cssText = `position: absolute; left: 10px; top: 10px; background-color: rgba(0,0,0,0.75); border-radius: 8px; padding: 10px; color: white; z-index: 101;`;
    document.body.appendChild(panel);

    const btnData = [
        { html: '▲', action: () => adjustCameraPositionSprite(0, 1) },
        { html: '◀', action: () => adjustCameraPositionSprite(-1, 0) },
        { html: '⌂', action: resetCameraPositionSprite },
        { html: '▶', action: () => adjustCameraPositionSprite(1, 0) },
        { html: '▼', action: () => adjustCameraPositionSprite(0, -1) },
        { html: '+', action: () => { orthoZoomFactor *= 0.9; updateOrthoCameraView(); } },
        { html: '−', action: () => { orthoZoomFactor *= 1.1; updateOrthoCameraView(); } },
        { html: 'Diag', action: diagnoseSpriteCapture }
    ];

    btnData.forEach(data => {
        const btn = document.createElement('button');
        btn.innerHTML = data.html;
        btn.style.cssText = 'width:30px; margin:2px; background:#555; color:white; border:none; cursor:pointer;';
        btn.onclick = data.action;
        panel.appendChild(btn);
    });
}

// --- LOGICA REFORMULADA DE CAPTURA E GERACAO ---
async function startSpriteSheetRecording() {
    if (!currentModel) { showStatus("Load a model first.", "error"); return; }
    
    const mode = captureModeSelect.value; // 'animated' ou 'static'
    
    if (mode === 'animated' && (!mixer || !currentAction)) {
        showStatus("No animation active for animated recording mode.", "error"); return;
    }

    isRecording = true;
    recordBtn.disabled = true; recordBtn.textContent = "Capturing...";
    if (isPreviewingOrtho) toggleOrthoPreview();

    if (axesHelper) axesHelper.visible = false;
    if (gridHelper) gridHelper.visible = false;
    if (boxHelper) boxHelper.visible = false;

    renderer.setClearColor(0x000000, 0); 
    scene.background = null;

    const isometricToggle = document.getElementById('captureIsometricToggle');
    let anglesToCapture = [0,90,270];
    if (isometricToggle && isometricToggle.checked) {
        anglesToCapture = [0, 45, 90, 135, 180, 225, 270, 315];
    }

    const baseName = currentAction ? currentAction.getClip().name : "static_asset";
    const filenameForSheet = baseName.replace(/[^\w-]/g, '_') || 'spritesheet';

    if (mode === 'static') {
        // --- PROCESSO DE CAPTURA PARA MODELOS ESTÁTICOS ---
        let localRecordedFrames = [];
        const box = new THREE.Box3().setFromObject(currentModel);
        const center = box.getCenter(new THREE.Vector3());
        
        const originalCamPos = orthoCamera.position.clone();
        const originalCamRot = orthoCamera.rotation.clone();
        const camDist = 10;

        for (let i = 0; i < anglesToCapture.length; i++) {
            const angleDeg = anglesToCapture[i] !== null ? anglesToCapture[i] : 0;
            const angleRad = THREE.MathUtils.degToRad(angleDeg);
            
            // Ângulo de inclinação isométrica real: atan(1 / sqrt(2)) ≈ 35.264°
            const isoElevationRad = THREE.MathUtils.degToRad(35.264);

            // Coordenadas esféricas perfeitas para projeção isométrica rotacional
            const x = cameraOffsetX + camDist * Math.sin(angleRad) * Math.cos(isoElevationRad);
            const z = camDist * Math.cos(angleRad) * Math.cos(isoElevationRad);
            const y = cameraOffsetY + camDist * Math.sin(isoElevationRad);

            orthoCamera.position.set(x, y, z);
            orthoCamera.lookAt(cameraOffsetX, cameraOffsetY, 0);
            orthoCamera.updateProjectionMatrix();

            // Renderiza e captura o frame único desse ângulo estático
            await new Promise((res) => {
                requestAnimationFrame(() => {
                    const cellW = parseInt(cellWidthInput.value) || 480;
                    const cellH = parseInt(cellHeightInput.value) || 480;
                    
                    const originalSize = new THREE.Vector2();
                    renderer.getSize(originalSize);
                    
                    renderer.setSize(cellW, cellH);
                    renderer.render(scene, orthoCamera);
                    
                    const dataURL = renderer.domElement.toDataURL('image/png');
                    const img = new Image();
                    img.onload = () => {
                        localRecordedFrames.push(img);
                        renderer.setSize(originalSize.x, originalSize.y);
                        res();
                    };
                    img.src = dataURL;
                });
            });
            showStatus(`Captured angle ${angleDeg}° (${i+1}/${anglesToCapture.length})`, "info");
        }

        // Gera a spritesheet consolidada contendo todos os ângulos capturados do objeto estático
        if (localRecordedFrames.length > 0) {
            generateSpriteSheetImage(`${filenameForSheet}_isometric_set`, localRecordedFrames);
        }

        // Restaura estados de câmera padrão
        orthoCamera.position.copy(originalCamPos);
        orthoCamera.rotation.copy(originalCamRot);
        updateOrthoCameraView();

    } else {
        // --- PROCESSO DE CAPTURA ANIMADO ORIGINAL (MANTIDO) ---
        const originalCamPos = orthoCamera.position.clone();
        for (let i = 0; i < anglesToCapture.length; i++) {
            const angleDeg = anglesToCapture[i];
            const angleName = angleDescriptions[angleDeg] || `angle${angleDeg}`;
            
            if (angleDeg !== null) {
                const angleRad = THREE.MathUtils.degToRad(angleDeg);
                orthoCamera.position.set(cameraOffsetX + 10 * Math.sin(angleRad), cameraOffsetY, 10 * Math.cos(angleRad));
                orthoCamera.lookAt(cameraOffsetX, cameraOffsetY, 0);
            }
            
            const currentFilename = filenameForSheet + (anglesToCapture.length > 1 ? `_${angleName}` : '');
            await captureAndGenerateSheetForAngle(currentFilename, anglesToCapture.length, i);
        }
        orthoCamera.position.copy(originalCamPos);
        updateOrthoCameraView();
    }

    // Finalização e restauração da UI
    if (axesHelper) axesHelper.visible = true;
    if (gridHelper) gridHelper.visible = true;
    if (boxHelper) boxHelper.visible = true;
    recordBtn.disabled = false; recordBtn.textContent = "Record Sprite Sheet";
    isRecording = false;
    showStatus("Capture completed successfully!", "info");
}

function captureAndGenerateSheetForAngle(filenameForSheet, totalAnglesParam, currentIndexParam) {
    return new Promise((resolve, reject) => {
        let localRecordedFrames = [];
        let localCurrentFrameBeingCaptured = 0;
        let localFrameCountToCapture = parseInt(framesInput.value) || 16;
        const localAnimationDuration = currentAction.getClip().duration; 

        if (localAnimationDuration <= 0) return resolve();

        currentAction.stop().play();
        currentAction.paused = true;

        function _captureSingleFrameInternalRecursive() {
            if (localCurrentFrameBeingCaptured >= localFrameCountToCapture) {
                if (localRecordedFrames.length > 0) generateSpriteSheetImage(filenameForSheet, localRecordedFrames);
                resolve();
                return;
            }

            const timeRatio = (localFrameCountToCapture > 1) ? (localCurrentFrameBeingCaptured / (localFrameCountToCapture - 1)) : 0;
            currentAction.time = timeRatio * localAnimationDuration;
            mixer.update(0.00001);

            requestAnimationFrame(() => {
                const cellW = parseInt(cellWidthInput.value) || 480;
                const cellH = parseInt(cellHeightInput.value) || 480;
                const originalSize = new THREE.Vector2();
                renderer.getSize(originalSize);
                
                renderer.setSize(cellW, cellH); 
                renderer.render(scene, orthoCamera);
                
                const dataURL = renderer.domElement.toDataURL('image/png');
                const img = new Image();
                img.onload = () => {
                    localRecordedFrames.push(img);
                    localCurrentFrameBeingCaptured++;
                    renderer.setSize(originalSize.x, originalSize.y);
                    setTimeout(_captureSingleFrameInternalRecursive, 50);
                };
                img.src = dataURL;
            });
        } 
        _captureSingleFrameInternalRecursive(); 
    }); 
}

function generateSpriteSheetImage(filename, framesArrayToUse) {
    const numFrames = framesArrayToUse.length;
    if (numFrames === 0) return;

    const numColumns = parseInt(columnsInput.value) || 4;
    const numRows = Math.ceil(numFrames / numColumns);
    const cellW = parseInt(cellWidthInput.value) || 480;
    const cellH = parseInt(cellHeightInput.value) || 480;
    const optimize = optimizeInput.checked;

    captureCanvas.width = cellW * numColumns;
    captureCanvas.height = cellH * numRows;
    captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);

    for (let i = 0; i < numFrames; i++) {
        const frameImg = framesArrayToUse[i];
        const r = Math.floor(i / numColumns);
        const c = i % numColumns;
        const destX = c * cellW;
        const destY = r * cellH;

        if (optimize) { 
            const bounds = analyzeFrameContent(frameImg);
            const drawW = bounds.width;
            const drawH = bounds.height;
            const offsetX = Math.floor((cellW - drawW) / 2);
            const offsetY = Math.floor((cellH - drawH) / 2);

            captureContext.drawImage(frameImg, bounds.left, bounds.top, drawW, drawH, destX + offsetX, destY + offsetY, drawW, drawH);
        } else {
            captureContext.drawImage(frameImg, 0, 0, frameImg.naturalWidth, frameImg.naturalHeight, destX, destY, cellW, cellH);
        }
    }

    const dataURL = captureCanvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = dataURL;
    downloadLink.download = `${filename}_sheet.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

function analyzeFrameContent(frameImage) { 
    if (!frameImage || !frameImage.naturalWidth) return { left: 0, top: 0, width: 256, height: 256 };
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = frameImage.naturalWidth;
    tempCanvas.height = frameImage.naturalHeight;
    tempCtx.drawImage(frameImage, 0, 0);

    const pixelData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
    let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0, found = false;

    for (let y = 0; y < tempCanvas.height; y++) {
        for (let x = 0; x < tempCanvas.width; x++) {
            if (pixelData[(y * tempCanvas.width + x) * 4 + 3] > 10) {
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                found = true;
            }
        }
    }
    if (!found) return { left: 0, top: 0, width: frameImage.naturalWidth, height: frameImage.naturalHeight };
    return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function updateModelRotation() {
    if (!currentModel) return;
    currentModel.rotation.set(
        THREE.MathUtils.degToRad(parseFloat(rotXInput.value) || 0),
        THREE.MathUtils.degToRad(parseFloat(rotYInput.value) || 0),
        THREE.MathUtils.degToRad(parseFloat(rotZInput.value) || 0)
    );
}

function resetModelRotation() {
    if (!currentModel) return;
    rotXInput.value = rotYInput.value = rotZInput.value = 0;
    currentModel.rotation.set(0, 0, 0);
}

window.alignModelToBase = function() {
    if (!currentModel) return;
    const box = new THREE.Box3().setFromObject(currentModel);
    currentModel.position.y -= box.min.y;
};

window.centerModelVertically = function() {
    if (!currentModel) return;
    const box = new THREE.Box3().setFromObject(currentModel);
    currentModel.position.y -= box.getCenter(new THREE.Vector3()).y;
};

window.moveModelVertical = function(amount) {
    if (!currentModel) return;
    currentModel.position.y += amount;
};