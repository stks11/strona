let map = L.map('map',{
    doubleClickZoom: false
});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    crossOrigin: true
}).addTo(map);

map.locate({ setView: true, maxZoom: 16 });

map.on('locationfound', function(e) {
    let radius = e.accuracy / 5;
    L.circle(e.latlng, radius).addTo(map);
});
map.on('locationerror', function () {
    map.setView([52.237049, 21.017532], 7);
});
L.Control.geocoder({
    drawMarker: true,
    icon: 'fa fa-map-marker', 
    iconLoading: 'fa fa-spinner fa-spin',  
    markerClass: L.circleMarker, 
}).addTo(map);

L.control.locate().addTo(map);

let selectedSegments = [];
let trackLayer = null;
let coordinates = [];
let elevationChart = null;
let segments = [];
let fileName = '';
let layers = [];
let layersCoordinates = [];
const fileButton = document.getElementById("fileButton");
const fileInput = document.getElementById("fileInput");

fileButton.addEventListener("click", () => {
  fileInput.click(); 
});
document.getElementById('fileInput').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        fileName  = file.name;
        const reader = new FileReader();
        reader.onload = function(e) {
            const gpxText = e.target.result;
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(gpxText, 'text/xml');
            let trackPoints = Array.from(xmlDoc.querySelectorAll('trkpt'));
            
            coordinates = trackPoints.map(point => {
                return [parseFloat(point.getAttribute('lon')), parseFloat(point.getAttribute('lat')), parseFloat(point.getElementsByTagName('ele')[0].textContent)];
            });
            layersCoordinates.push(coordinates);
            let trackJSON = {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates
                }
            };
            trackLayer = L.geoJSON(trackJSON).addTo(map);
            trackLayer.fileName = file.name;
            layers.push(trackLayer);
            layerSelection(trackLayer);
            manageLayersControl();
            map.fitBounds(trackLayer.getBounds());
            
        };
        reader.readAsText(file);
    }

});
function splitGPXByParts(coordinatesToSplit, parts) {
    const totalPoints = coordinatesToSplit.length;
    const baseSegments = Math.floor(totalPoints / parts);
    const extraSegments = totalPoints % parts;
    let startIndex = 0;
    const segments = [];
    for (let i = 0; i < parts; i++) {
        const segmentCount = baseSegments + (i < extraSegments ? 1 : 0);
        const endIndex = startIndex + segmentCount;
        const segmentCoordinates = coordinatesToSplit.slice(startIndex, endIndex + 1);
        if (segmentCoordinates.length > 1) {
            segments.push(segmentCoordinates);
        }; 
        startIndex = endIndex;
    }
    console.log("Segmenty:", segments);
    return segments;
}
function SplitGPXByKilometer(coordinatesToSplit, segmentLengthKm) {
    let line = turf.lineString(coordinatesToSplit);
    let totalLength = turf.length(line, { units: 'kilometers' });
    let currentDistance = 0;
    while (currentDistance < totalLength) {
        let start = currentDistance;
        let end = Math.min(currentDistance + segmentLengthKm, totalLength);
        let segment = turf.lineSliceAlong(line, start, end, { units: 'kilometers' });
        segments.push(segment.geometry.coordinates);
        console.log(currentDistance);
        currentDistance = end;
    }
    return segments;
}
function layerSelection(layer) {
    if (layer.eachLayer) {
        layer.eachLayer(function (segmentLayer) {
            setupLayerClick(segmentLayer);
        });
    } else {
        setupLayerClick(layer);
        
    }
}

function setupLayerClick(layer) {
    layer.on('click', function () {
        const modifiedId = layer._leaflet_id + 1;
        const existingSegment = selectedSegments.find(item => item.layer === layer);
        if (existingSegment) {
            selectedSegments = selectedSegments.filter(item => item.layer !== layer);
            layer.setStyle({ weight: 3 });
        } else {
            selectedSegments.push({ layer: layer, modifiedId: modifiedId });
            layer.setStyle({ weight: 5 });
        }
    });
}
function mergeGPX() {
    if (selectedSegments.length === 0) {
        alert("Zaznacz segmenty do scalenia");
        return;
    }
    let mergedCoordinates = [];
    selectedSegments.forEach(({ layer }) => {
        const geoJSON = layer.toGeoJSON();
        if (geoJSON.geometry && geoJSON.geometry.coordinates) {
            mergedCoordinates = mergedCoordinates.concat(geoJSON.geometry.coordinates);
            
        }
    });
    if (mergedCoordinates.length === 0) {
        return;
    }
    const mergedTrackJSON = {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": mergedCoordinates
        }
    };
    const mergedTrackLayer = L.geoJSON(mergedTrackJSON, {
        style: { weight: 3 }
    }).addTo(map);
    layerSelection(mergedTrackLayer);
    mergedTrackLayer.fileName = `Połączone - ${mergedTrackLayer._leaflet_id}`;
    layers.push(mergedTrackLayer);
    layersCoordinates.push(mergedCoordinates);
    selectedSegments.forEach(({ modifiedId }) => {
        const layerIndex = layers.findIndex(layer => layer._leaflet_id === modifiedId);
        map.removeLayer(layers[layerIndex]);
        layers.splice(layerIndex, 1);
        layersCoordinates.splice(layerIndex, 1);
        
        const listItem = layersList.querySelector(`[data-layer-id="${modifiedId}"]`);
        if (listItem) {
            layersList.removeChild(listItem);
    }
    manageLayersControl();
    });
    selectedSegments = [];
    map.fitBounds(mergedTrackLayer.getBounds());
}

async function fetchRouteFromOSRM(start, end) {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}?overview=full&geometries=geojson`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      return data.routes[0].geometry; 
    } catch (error) {
      console.error("Błąd:", error);
      throw error;
    }
}
function fillGap() {
if (selectedSegments.length>1){
    const firstPoint = selectedSegments[0].layer.feature.geometry.coordinates;
    const lastPoint = selectedSegments[1].layer.feature.geometry.coordinates;
    const latlngfirst = firstPoint.at(-1);
    const start = [latlngfirst[0],latlngfirst[1]];
    const latlnglast = lastPoint.at(0);
    const end = [latlnglast[0],latlnglast[1]]
    fetchRouteFromOSRM(start, end)
        .then((routeGeometry) => {
        combinedPoints = routeGeometry;
        const lineString = {
            type: "Feature",
            geometry: combinedPoints
        };
        const color = "black"
        const lineLayer = L.geoJSON(lineString, { style: { color: color } }).addTo(map);
        layers.push(lineLayer);
        layerSelection(lineLayer);
        selectedSegments = [];
        lineLayer.fileName = `Fill - ${color}`
        manageLayersControl();
        })
        .catch((error) => {
        });
    }else if (selectedSegments.length===0){
        alert("Zaznacz dwie widoczne warstwy")
    }else{
        alert("Zaznacz tylko dwie widoczne warstwy")
    }
}

document.getElementById('ile').style.display = 'none';
document.getElementById('ile2').style.display = 'none';
document.querySelector('label[for="ile"]').style.display = 'none';
document.querySelector('label[for="ile2"]').style.display = 'none';

const radioButtons = document.querySelectorAll('input[name="wybor"]');
const divideButton = document.getElementById('divide');
const ileInput = document.getElementById('ile');
const ile2Input = document.getElementById('ile2');


const dialog = document.getElementById('choose');
function splitGPXHandler() {
    if(layers.length===0){
        alert("Brak warstw na mapie, dodaj warstwy aby wykonać operację")
    }else if(selectedSegments.length>1){
        alert('Zaznaczono zbyt wiele warstw. Zaznacz jedną widoczną warstwę')
    }
    else if(selectedSegments.length===1 || layers.length===1){
        dialog.showModal();
        const wyborForm = dialog.querySelector('form');
        wyborForm.querySelectorAll('input[name="wybor"]').forEach(input => {
            input.addEventListener('change', function() {
                document.getElementById('ile').style.display = 'none';
                document.querySelector('label[for="ile"]').style.display = 'none';
                document.getElementById('ile2').style.display = 'none';
                document.querySelector('label[for="ile2"]').style.display = 'none';
                if (this.value === 'opcja1') {
                    document.getElementById('ile').style.display = 'inline';
                    document.querySelector('label[for="ile"]').style.display = 'inline';
                } else if (this.value === 'opcja2') {
                    document.getElementById('ile2').style.display = 'inline';
                    document.querySelector('label[for="ile2"]').style.display = 'inline';
            }
        });
    });
    }
}

function splitGPX() {
    const layersList = document.getElementById('layersList');
    let layerToSplit;
    let modifiedId;
    if(layers.length===1){
        layerToSplit = layers[0];
        modifiedId = layerToSplit._leaflet_id;
    }else if (selectedSegments.length>0){
    ({ layer: layerToSplit, modifiedId } = selectedSegments[0]);
    }
    const index = layers.findIndex(layer =>
        layer._leaflet_id === layerToSplit._leaflet_id || layer._leaflet_id === modifiedId
    );
    if (index === -1) {
        alert("Nie można znaleźć warstwy");
        return;
    }
    const coordinatesToSplit = layersCoordinates[index];
    console.log(coordinatesToSplit);
    if (!coordinatesToSplit || coordinatesToSplit.length === 0) {
        return;
    }
    map.removeLayer(layerToSplit);
    layers.splice(index, 1);
    layersCoordinates.splice(index, 1);
    const selectedOption = document.querySelector('input[name="wybor"]:checked')?.value;
    if (!selectedOption) {
        alert("Wybierz opcję podziału");
        return;
    }
    let segmentsToAdd;
    if (selectedOption === 'opcja1') {
        const parts = parseInt(ileInput.value);
        if (isNaN(parts) || parts <= 0) {
            alert("Podaj poprawną liczbę części");
            return;
        }
        segmentsToAdd = splitGPXByParts(coordinatesToSplit, parts);
    } else if (selectedOption === 'opcja2') {
        const segmentLengthKm = parseFloat(ile2Input.value);
        if (isNaN(segmentLengthKm) || segmentLengthKm <= 0) {
            alert("Podaj poprawną długość");
            return;
        }
        segmentsToAdd = SplitGPXByKilometer(coordinatesToSplit, segmentLengthKm);

    }
    if (!segmentsToAdd || segmentsToAdd.length === 0) {
        alert("Warstwa nie została podzielona");
        return;
    }
    const listItem = layersList.querySelector(`[data-layer-id="${modifiedId}"]`);
    if (listItem) {
        layersList.removeChild(listItem);
    }
    segmentsToAdd.forEach((coordinates, index) => {
        const trackJSON = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates
            }
        };
        const colors = ['red', 'green', 'orange', 'purple', 'yellow'];
        const color = colors[index % colors.length];
        const trackSegmentLayer = L.geoJSON(trackJSON, {
            style: { color: color, weight: 3 }
        }).addTo(map);
        trackSegmentLayer.fileName = `Segment ${index + 1} - ${color}`;
        console.log("tracksegmentlayer:", trackSegmentLayer)
        segments.push(trackSegmentLayer);
        layers.push(trackSegmentLayer);
        layersCoordinates.push(coordinates);
        layerSelection(trackSegmentLayer);
    });
    manageLayersControl();
    selectedSegments = [];
    dialog.close();
}

document.getElementById('divide').addEventListener('click', (e) => {
    splitGPX();
});

function clearMap() {
    const layersList = document.getElementById('layersList');
    if (selectedSegments.length > 0) {
        selectedSegments.forEach(({ modifiedId }) => {
            const layerIndex = layers.findIndex(layer => layer._leaflet_id === modifiedId);
            if (layerIndex !== -1) {
                map.removeLayer(layers[layerIndex]);
                layers.splice(layerIndex, 1);
                layersCoordinates.splice(layerIndex, 1);
            }
            const listItem = layersList.querySelector(`[data-layer-id="${modifiedId}"]`);
            if (listItem) {
                layersList.removeChild(listItem);
            }
        });
        selectedSegments = [];
        return;
    }
    if (layers.length > 0) {
        layers.forEach(layer => {
            if (layer) {
                map.removeLayer(layer);
                trackLayer = null;
            }
        });
        layers = [];
    }
    layersCoordinates = [];
    coordinates = [];
    selectedSegments = [];
    segments = [];
    if (layersList) {
        layersList.innerHTML = '';
    }
    const tableBody = document.getElementById('statsTable')?.querySelector('tbody');
    if (tableBody) {
        tableBody.innerHTML = '';
    }
    const statsTable = document.getElementById('statsTable');
    if (statsTable) {
        statsTable.style.display = 'none';
    }
    const fileInputElement = document.getElementById('fileInput');
    if (fileInputElement) {
        fileInputElement.value = '';
    }
}

const dialogDownload = document.getElementById('dialogDownload')

document.getElementById('save').addEventListener('click', (e) => {
    e.preventDefault();
    if ((!segments || segments.length === 0) && !trackLayer) {
        alert("Brak danych do zapisania.");
        return;
    }
    let gpxData = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <metadata>
    <name>Trasa GPX - ${new Date().toISOString()}</name>
  </metadata>
  <trk>
    <trkseg>
`;
    let dataToSave = [];
    if (selectedSegments.length > 0) {
        selectedSegments.forEach(segment => {
            const coordinates = segment.layer.feature.geometry.coordinates;
            dataToSave = dataToSave.concat(coordinates);
        });
    } else if (coordinates.length > 0) {
        dataToSave = coordinates;
    } else {
        alert("Brak wybranych segmentów do zapisania.");
        return;
    }
    dataToSave.forEach(([lon, lat, ele = 0]) => {
        gpxData += `<trkpt lon="${lon}" lat="${lat}">
      <ele>${ele}</ele>
    </trkpt>\n`;
    });

    gpxData += `    </trkseg>
  </trk>
</gpx>`;
    const blob = new Blob([gpxData], { type: 'application/gpx+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const fileNameInput = document.getElementById('stext');
    const fileName = fileNameInput && fileNameInput.value.trim() ? fileNameInput.value.trim() : 'Trasa';
    link.download = `${fileName}.gpx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    dialogDownload.close();
});


function downloadGPXHandler() {
    if(layers.length>0){
    dialogDownload.showModal();
    }else{
        alert('Brak danych do zapisania!')
    }
    const name = document.getElementById('stext');
    name.value = '';
    const check = document.getElementById('select')
    check.checked = false;
 
}
function createElevationChart(distances, elevations) {
    const ctx = document.getElementById('elevationChart').getContext('2d');
    const formattedDistances = distances.map(value => parseFloat(value.toFixed(2)));
    const formattedElevations = elevations.map(value => parseFloat(value.toFixed(2)));
    if (elevationChart !== null) {
        elevationChart.destroy();
    }
    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedDistances,
            datasets: [{
                label: 'Wysokość n.p.m.(m)',
                data: formattedElevations,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Odległość (km)'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Przewyższenie (m)'
                    }
                }
            }
        }
    });
}

function createButton(text, title, onClick, container) {
    const button = L.DomUtil.create('a', '', container);
    button.href = '#';
    button.textContent = text;
    button.style.background = 'white';
    button.title = title;

    L.DomEvent.on(button, 'click', function(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        onClick();
    });

    return button;
}

let CustomControl = L.Control.extend({
    options: {
        position: 'topright'
    },
    onAdd: function(map) {
        let container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');

        createButton('D', 'Dzieli zaznaczoną warstwę na segmenty', splitGPXHandler, container);
        createButton('M', 'Łączy zaznaczone segmenty w jedną warstwę', mergeGPX, container);
        createButton('S', 'Wyświetla statystyki zaznaczonej warstwy w tabeli', stats, container);
        createButton('C', 'Czyści mapę lub usuwa wskazane warstwy/segmenty', clearMap, container);
        createButton('↓', 'Zapisuje wskazaną warstwę do pliku', downloadGPXHandler, container);
        createButton('F', 'Wypełnia lukę pomiędzy dwoma warstwami', fillGap, container);

        return container;
    }
});


map.addControl(new CustomControl());

const LayersControl = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-control-layers');
        container.style.backgroundColor = 'white';
        container.style.padding = '10px';
        container.style.maxHeight = '200px';
        container.style.overflowY = 'auto';
        container.style.fontSize = '14px';

        const header = L.DomUtil.create('strong', '', container);
        header.textContent = 'Warstwy:';

        const layersList = L.DomUtil.create('ul', '', container);
        layersList.id = 'layersList';
        layersList.style.listStyle = 'none';
        layersList.style.padding = '0';

        L.DomEvent.disableClickPropagation(container);

        return container;
    }
});
map.addControl(new LayersControl());

function manageLayersControl() {
    const layersList = document.getElementById('layersList');
    layersList.innerHTML = '';

    layers.forEach((layer, index) => {
        const listItem = document.createElement('li'); 
        listItem.style.display = 'flex';
        listItem.style.marginBottom = '5px';
        listItem.dataset.layerId = layer._leaflet_id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.cursor = 'pointer';
        checkbox.checked = map.hasLayer(layer); 
        

        const label = document.createElement('span');
        label.textContent = layer.fileName || `Warstwa ${index + 1}`;

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                map.addLayer(layer); 
            } else {
                map.removeLayer(layer); 
            }
        });
        listItem.appendChild(checkbox);
        listItem.appendChild(label);
        layersList.appendChild(listItem);
    });
}

function stats() {
    const statsTable = document.getElementById('statsTable');
    const tableBody = statsTable.querySelector('tbody');
    if (statsTable.style.display === 'table') {
        statsTable.style.display = 'none';
        document.getElementById('elevationChart').style.display = 'none';
        return;
    } else {
        if (selectedSegments.length > 0) {
            let stats = { pointCount: 0, totalLength: 0, elevationGain: 0 };
            let distances = [];
            let elevations = [];
            
            selectedSegments.forEach(({ modifiedId }) => {
                const layerIndex = layers.findIndex(layer => layer._leaflet_id === modifiedId);
                if (layerIndex !== -1) {
                    const coordinates = layersCoordinates[layerIndex];
                    stats.pointCount += coordinates.length;

                    let segmentLength = 0;
                    let segmentElevationGain = 0;
                    let totalDistance = distances.length > 0 ? distances[distances.length - 1] : 0;

                    for (let i = 0; i < coordinates.length - 1; i++) {
                        const start = L.latLng(coordinates[i][1], coordinates[i][0]);
                        const end = L.latLng(coordinates[i + 1][1], coordinates[i + 1][0]);

                        const distance = start.distanceTo(end) / 1000;
                        segmentLength += distance;

                        totalDistance += distance;
                        distances.push(totalDistance);

                        const elevationDiff = coordinates[i + 1][2] - coordinates[i][2];
                        if (elevationDiff > 0) {
                            segmentElevationGain += elevationDiff;
                        }

                        elevations.push(coordinates[i + 1][2]);
                    }

                    stats.totalLength += segmentLength;
                    stats.elevationGain += segmentElevationGain;
                }
            });
            tableBody.innerHTML = '';
            const row = document.createElement('tr');
            const cellCount = document.createElement('td');
            const cellLength = document.createElement('td');
            const cellElevation = document.createElement('td');
            cellCount.textContent = stats.pointCount;
            cellLength.textContent = stats.totalLength.toFixed(2);
            cellElevation.textContent = stats.elevationGain.toFixed(0);
            row.appendChild(cellCount);
            row.appendChild(cellLength);
            row.appendChild(cellElevation);
            tableBody.appendChild(row);
            statsTable.style.display = 'table';

            if (distances.length > 0 && elevations.length > 0) {
                createElevationChart(distances, elevations);
                document.getElementById('elevationChart').style.display = 'block';
            }
        } else {
            alert("Nie zaznaczono warstwy lub brak punktów.");
        }
    }
}


