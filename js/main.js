import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {RoundedBoxGeometry} from "three/addons/geometries/RoundedBoxGeometry.js";

const containerEl = document.querySelector('.container');
const canvasEl = document.querySelector('#canvas');
const selectorEl = document.querySelector('#selector');
const loaderEl = document.querySelector('#loader');

let renderer, mainScene, mainCamera, mainOrbit, lightHolder, topLight;
let instancedMesh, voxelGeometry, voxelMaterial;
let dummy, rayCaster, rayCasterIntersects = [];
let previewScenes = [];

const voxelsPerModel = [];
let voxels = [];

let activeModelIdx = 4;
const modelURLs = [
   './models/banana.glb',
    './models/cherry.glb',
    './models/chilli.glb',
   './models/banana.glb',
    './models/cherry.glb',
    './models/chilli.glb',
]

const params = {
    modelPreviewSize: 2,
    modelSize: 9,
    gridSize: .24,
    boxSize: .24,
    boxRoundness: .03
}

createMainScene();
loadModels();

window.addEventListener('resize', updateSceneSize);

function createMainScene() {

    renderer = new THREE.WebGLRenderer({
        canvas: canvasEl,
        alpha: true,
        antialias: true
    });
    renderer.shadowMap.enabled = true;
    renderer.shadowMapSoft = true;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setScissorTest(true);

    mainScene = new THREE.Scene();

    mainCamera = new THREE.PerspectiveCamera(45, containerEl.clientWidth / containerEl.clientHeight, .01, 1000);
    mainCamera.position.set(0, .5, 2).multiplyScalar(8);

    rayCaster = new THREE.Raycaster();
    dummy = new THREE.Object3D();

    const ambientLight = new THREE.AmbientLight(0xffffff, .5);
    mainScene.add(ambientLight);

    lightHolder = new THREE.Group();

    topLight = new THREE.SpotLight(0xffffff, .4);
    topLight.position.set(0, 15, 3);
    topLight.castShadow = true;
    topLight.shadow.camera.near = 10;
    topLight.shadow.camera.far = 30;
    topLight.shadow.mapSize = new THREE.Vector2(1024, 1024);
    lightHolder.add(topLight);

    const sideLight = new THREE.SpotLight(0xffffff, .4);
    sideLight.position.set(0, -4, 5);
    lightHolder.add(sideLight);

    mainScene.add(lightHolder);

    mainOrbit = new OrbitControls(mainCamera, containerEl);
    mainOrbit.enablePan = false;
    mainOrbit.autoRotate = true;
    mainOrbit.minDistance = 20;
    mainOrbit.maxDistance = 30;
    mainOrbit.minPolarAngle = .35 * Math.PI;
    mainOrbit.maxPolarAngle = .65 * Math.PI;
    mainOrbit.enableDamping = true;

    voxelGeometry = new RoundedBoxGeometry(params.boxSize, params.boxSize, params.boxSize, 2, params.boxRoundness);
    voxelMaterial = new THREE.MeshLambertMaterial({});

    const planeGeometry = new THREE.PlaneGeometry(35, 35);
    const shadowPlaneMaterial = new THREE.ShadowMaterial({
        opacity: .1
    });
    const shadowPlaneMesh = new THREE.Mesh(planeGeometry, shadowPlaneMaterial);
    shadowPlaneMesh.position.y = -4;
    shadowPlaneMesh.rotation.x = -.5 * Math.PI;
    shadowPlaneMesh.receiveShadow = true;

    lightHolder.add(shadowPlaneMesh);
}

function createPreviewScene(modelIdx) {
    const scene = new THREE.Scene();

    scene.background = new THREE.Color().setHSL((modelIdx / modelURLs.length), .5, .7);

    const element = document.createElement('div');
    element.className = "model-prev";
    scene.userData.element = element;
    scene.userData.modelIdx = modelIdx;
    selectorEl.appendChild(element);

    const camera = new THREE.PerspectiveCamera(50, 1, 1, 100);
    camera.position.set(0, 1, 2).multiplyScalar(1.2);
    scene.userData.camera = camera;

    const orbit = new OrbitControls(scene.userData.camera, scene.userData.element);
    orbit.minDistance = 2;
    orbit.maxDistance = 5;
    orbit.autoRotate = true;
    orbit.autoRotateSpeed = 6;
    orbit.enableDamping = true;
    scene.userData.orbit = orbit;

    const ambientLight = new THREE.AmbientLight(0xffffff, .9);
    scene.add(ambientLight);
    const sideLight = new THREE.PointLight(0xffffff, .7);
    sideLight.position.set(2, 0, 5);
    scene.add(sideLight);

    return scene;
}

function loadModels() {

    recreateInstancedMesh(100);

    const loader = new GLTFLoader();
    let modelsLoadCnt = 0;
    modelURLs.forEach((url, modelIdx) => {

        // prepare <div> and Three.js scene for model preview
        const scene = createPreviewScene(modelIdx);
        previewScenes.push(scene);

        // load .glb file
        loader.load(url, (gltf) => {

            // add scaled and centered model to the preview panel;
            addModelToPreview(modelIdx, gltf.scene)

            // get the voxel data from the model
            voxelizeModel(modelIdx, gltf.scene);
            
            // update the instanced mesh
            const numberOfInstances = Math.max(...voxelsPerModel.map(m => m.length));
            if (numberOfInstances > instancedMesh.count) {
                recreateInstancedMesh(numberOfInstances);
            }

            // once all the models are loaded...
            modelsLoadCnt++;
            if (modelsLoadCnt === 1) {
                // Once we have once voxelized model ready, start rendering the available content
                gsap.set(loaderEl, {
                    innerHTML: "calculating the voxels...",
                    y: .3 * window.innerHeight
                })
                updateSceneSize();
                render();
            }
            if (modelsLoadCnt === modelURLs.length) {
                // Once we have all the models voxelized, start the animation
                gsap.to(loaderEl, {
                    duration: .3,
                    opacity: 0
                })
                animateVoxels(0, activeModelIdx);
                setupSelectorEvents();
            }
        }, undefined, (error) => {
            console.error(error);
        });
    })
}

function setupSelectorEvents() {

    const highlightActivePreview = () => {
        Array.from(document.querySelectorAll('.model-prev')).forEach((el, idx) => {
            if (idx !== activeModelIdx) {
                el.classList.remove('active')
            } else {
                el.classList.add('active')
            }
        })
    }

    let timeOut, isHeldDown = false;
    highlightActivePreview();

    previewScenes.forEach(scene => {
        scene.userData.element.addEventListener('mouseup', () => {
            clearTimeout(timeOut);
            if (!isHeldDown) {
                animateVoxels(activeModelIdx, scene.userData.modelIdx);
                activeModelIdx = scene.userData.modelIdx;
                highlightActivePreview();
            }
            isHeldDown = false;
        })
    });
    window.addEventListener('mousedown', () => {
        timeOut = setTimeout(() => {
            isHeldDown = true;
        }, 200);
    });
    window.addEventListener('mouseup', e => {
        clearTimeout(timeOut);
        if (!isHeldDown) {
            if (!e.target.classList.contains('model-prev')) {
                if (modelURLs[activeModelIdx + 1]) {
                    animateVoxels(activeModelIdx, activeModelIdx + 1);
                    activeModelIdx++;
                } else {
                    animateVoxels(activeModelIdx, 0);
                    activeModelIdx = 0;
                }
                highlightActivePreview();
            }
        }
        isHeldDown = false;
    });
}

function addModelToPreview(modelIdx, importedScene) {
    const model = importedScene.clone();
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scaleFactor = params.modelPreviewSize / size.length();

    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(-scaleFactor);
    model.position.copy(center);
    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
    previewScenes[modelIdx].add(model);
}

function voxelizeModel(modelIdx, importedScene) {

    const importedMeshes = [];
    importedScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material.side = THREE.DoubleSide;
            importedMeshes.push(child);
        }
    });

    let boundingBox = new THREE.Box3().setFromObject(importedScene);
    const size = boundingBox.getSize(new THREE.Vector3());
    const scaleFactor = params.modelSize / size.length();
    const center = boundingBox.getCenter(new THREE.Vector3()).multiplyScalar(-scaleFactor);

    importedScene.scale.multiplyScalar(scaleFactor);
    importedScene.position.copy(center);

    boundingBox = new THREE.Box3().setFromObject(importedScene);
    boundingBox.min.y += .5 * params.gridSize; // for egg grid to look better

    let modelVoxels = [];

    for (let i = boundingBox.min.x; i < boundingBox.max.x; i += params.gridSize) {
        for (let j = boundingBox.min.y; j < boundingBox.max.y; j += params.gridSize) {
            for (let k = boundingBox.min.z; k < boundingBox.max.z; k += params.gridSize) {
                for (let meshCnt = 0; meshCnt < importedMeshes.length; meshCnt++) {
                    const mesh = importedMeshes[meshCnt];

                    const color = new THREE.Color();
                    const {h, s, l} = mesh.material.color.getHSL(color);
                    color.setHSL(h, s * .8, l * .8 + .2);
                    const pos = new THREE.Vector3(i, j, k);
                    
                    if (isInsideMesh(pos, new THREE.Vector3(0, 0, 1), mesh)) {
                        modelVoxels.push({color: color, position: pos});
                        break;
                    }
                }
            }
        }
    }

    voxelsPerModel[modelIdx] = modelVoxels;
}

function isInsideMesh(pos, ray, mesh) {
    rayCaster.set(pos, ray);
    rayCasterIntersects = rayCaster.intersectObject(mesh, false);
    return rayCasterIntersects.length % 2 === 1;
}

function recreateInstancedMesh(cnt) {

    // remove the old mesh and voxels data
    voxels = [];
    mainScene.remove(instancedMesh);

    // re-initiate the voxel array with random colors and positions
    for (let i = 0; i < cnt; i++) {
        const randomCoordinate = () => {
            let v = (Math.random() - .5);
            v -= (v % params.gridSize);
            return v;
        }
        voxels.push({
            position: new THREE.Vector3(randomCoordinate(), randomCoordinate(), randomCoordinate()),
            color: new THREE.Color().setHSL(Math.random(), .8, .8)
        })
    }
    
    // create a new instanced mesh object
    instancedMesh = new THREE.InstancedMesh(voxelGeometry, voxelMaterial, cnt);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;

    // assign voxels data to the instanced mesh
    for (let i = 0; i < cnt; i++) {
        instancedMesh.setColorAt(i, voxels[i].color);
        dummy.position.copy(voxels[i].position);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.instanceColor.needsUpdate = true;

    // add a new mesh to the scene
    mainScene.add(instancedMesh);
}

function animateVoxels(oldModelIdx, newModelIdx) {

    // animate voxels data
    for (let i = 0; i < voxels.length; i++) {

        gsap.killTweensOf(voxels[i].color);
        gsap.killTweensOf(voxels[i].position);

        const duration = .5 + .5 * Math.pow(Math.random(), 6);
        let targetPos;

        // move to new position if we have one;
        // otherwise, move to a randomly selected existing position
        //
        // animate to new color if it's determined
        // otherwise, voxel will be just hidden by animation of instancedMesh.count

        if (voxelsPerModel[newModelIdx][i]) {
            targetPos = voxelsPerModel[newModelIdx][i].position;
            gsap.to(voxels[i].color, {
                delay: .7 * Math.random() * duration,
                duration: .05,
                r: voxelsPerModel[newModelIdx][i].color.r,
                g: voxelsPerModel[newModelIdx][i].color.g,
                b: voxelsPerModel[newModelIdx][i].color.b,
                ease: "power1.in",
                onUpdate: () => {
                    instancedMesh.setColorAt(i, voxels[i].color);
                }
            })
        } else {
            targetPos = voxelsPerModel[newModelIdx][Math.floor(voxelsPerModel[newModelIdx].length * Math.random())].position;
        }

        // move to new position if it's determined
        gsap.to(voxels[i].position, {
            delay: .2 * Math.random(),
            duration: duration,
            x: targetPos.x,
            y: targetPos.y,
            z: targetPos.z,
            ease: "back.out(3)",
            onUpdate: () => {
                dummy.position.copy(voxels[i].position);
                dummy.updateMatrix();
                instancedMesh.setMatrixAt(i, dummy.matrix);
            }
        });
    }

    // increase the model rotation during transition
    gsap.to(instancedMesh.rotation, {
        duration: 1.2,
        y: "+=" + 1.3 * Math.PI,
        ease: "power2.out"
    })

    // show the right number of voxels
    gsap.to(instancedMesh, {
        duration: .4,
        count: voxelsPerModel[newModelIdx].length
    })

    // update the instanced mesh accordingly to voxels data
    gsap.to({}, {
        duration: 1, // max transition duration
        onUpdate: () => {
            instancedMesh.instanceColor.needsUpdate = true;
            instancedMesh.instanceMatrix.needsUpdate = true;
        }
    });
}

function render() {
    renderer.setViewport(0, 0, containerEl.clientWidth, containerEl.clientHeight);
    renderer.setScissor(0, 0, containerEl.clientWidth, containerEl.clientHeight);
    mainOrbit.update();
    lightHolder.quaternion.copy(mainCamera.quaternion);
    renderer.render(mainScene, mainCamera);

    // render previews
    previewScenes.forEach((scene) => {
        renderer.setViewport(scene.userData.rect.left, scene.userData.rect.bottom, scene.userData.rect.width, scene.userData.rect.height);
        renderer.setScissor(scene.userData.rect.left, scene.userData.rect.bottom, scene.userData.rect.width, scene.userData.rect.height);
        scene.userData.orbit.update();
        renderer.render(scene, scene.userData.camera);
    });

    requestAnimationFrame(render);
}

function updateSceneSize() {
    mainCamera.aspect = containerEl.clientWidth / containerEl.clientHeight;
    mainCamera.updateProjectionMatrix();

    previewScenes.forEach(scene => {
        scene.userData.element.style.width = Math.min(90, window.innerHeight * .8 / modelURLs.length) + 'px';
    })
    previewScenes.forEach(scene => {
        const rect = scene.userData.element.getBoundingClientRect();
        scene.userData.rect = {
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            left: rect.left,
            bottom: containerEl.clientHeight - rect.bottom
        }
        scene.userData.camera.aspect = scene.userData.element.clientWidth / scene.userData.element.clientHeight;
        scene.userData.camera.updateProjectionMatrix();
    });

    renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
}