let map = L.map('map');
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

let selectedSegments = [];
let trackLayer = null;
let coordinates = [];
let elevationChart = null;
let segments = [];
let refreshCoordinates = [];
let fileName = '';
let layers = [];
let layersCoordinates = [];
const fileButton = document.getElementById("fileButton");
const fileInput = document.getElementById("fileInput");

fileButton.addEventListener("click", () => {
  fileInput.click(); 
});
// fileInput.addEventListener("change", (event) => {
//   const files = event.target.files;
// });

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
            refreshCoordinates = coordinates;
            layersCoordinates.push(refreshCoordinates);
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
function splitGPXByParts(refreshCoordinates, parts) {
    const totalPoints = refreshCoordinates.length;
    const baseSegments = Math.floor(totalPoints / parts);
    const extraSegments = totalPoints % parts;
    let startIndex = 0;
    const segments = [];
    for (let i = 0; i < parts; i++) {
        const segmentCount = baseSegments + (i < extraSegments ? 1 : 0);
        const endIndex = startIndex + segmentCount;
        const segmentCoordinates = refreshCoordinates.slice(startIndex, endIndex + 1);
        if (segmentCoordinates.length > 1) {
            segments.push(segmentCoordinates);
        } else {
            console.warn(`Pominięto pusty lub zbyt krótki segment:`, segmentCoordinates);
        }
        startIndex = endIndex;
    }
    console.log("Segmenty po podziale na części:", segments);
    return segments;
}
function splitLineByKilometer(refreshCoordinates, segmentLengthKm) {
    let line = turf.lineString(refreshCoordinates);
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
        console.log("Zaznaczone segmenty:", selectedSegments);
    });
}
function mergeGPX() {
    if (selectedSegments.length === 0) {
        alert("Nie zaznaczono żadnych segmentów do scalenia.");
        return;
    }
    let mergedCoordinates = [];
    let isTooFar = false;
    selectedSegments.forEach(({ layer }) => {
        const geoJSON = layer.toGeoJSON();
        if (geoJSON.geometry && geoJSON.geometry.coordinates) {
            mergedCoordinates = mergedCoordinates.concat(geoJSON.geometry.coordinates);
            console.log(mergedCoordinates);
        }
    });
    if (mergedCoordinates.length === 0) {
        alert("Nie udało się scalić współrzędnych. Sprawdź zaznaczone segmenty.");
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
        console.log("Sprawdzanie zaznaczonego modifiedId:", modifiedId);
        const layerIndex = layers.findIndex(layer => layer._leaflet_id === modifiedId);
        if (layerIndex !== -1) {
            console.log(`Usuwanie warstwy z layers, indeks: ${layerIndex}, _leaflet_id: ${layers[layerIndex]._leaflet_id}`);
            map.removeLayer(layers[layerIndex]);
            layers.splice(layerIndex, 1);
            layersCoordinates.splice(layerIndex, 1);
        } else {
            console.warn(`Nie znaleziono warstwy w 'layers' dla modifiedId: ${modifiedId}`);
        }
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
      if (!response.ok) {
        throw new Error(`Błąd podczas pobierania trasy: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.routes.length === 0) {
        throw new Error("Brak dostępnej trasy między punktami.");
      }
      return data.routes[0].geometry; 
    } catch (error) {
      console.error("Błąd w fetchRouteFromOSRM:", error);
      throw error;
    }
}
function fillGap() {
if (selectedSegments.length>1){
    const firstPoint = selectedSegments[0].layer.feature.geometry.coordinates;
    const lastPoint = selectedSegments[1].layer.feature.geometry.coordinates;
    const latlngfirst = firstPoint.at(-1);
    const start = [latlngfirst[0],latlngfirst[1]];
    const latlnglast = lastPoint.at(-1);
    const end = [latlnglast[0],latlnglast[1]]
    fetchRouteFromOSRM(start, end)
        .then((routeGeometry) => {
        combinedPoints = routeGeometry;
        console.log(combinedPoints)
        console.log(combinedPoints);
        const lineString = {
            type: "Feature",
            geometry: combinedPoints
        };
        const color = "black"
        const lineLayer = L.geoJSON(lineString, { style: { color: color } }).addTo(map);
        layers.push(lineLayer);
        layerSelection(lineLayer);
        lineLayer.fileName = `Fill - ${color}`
        manageLayersControl();
        })
        .catch((error) => {
        console.error("Błąd podczas wypełniania luki:", error);
        });
    }else if (selectedSegments.length>2){
        alert("Zaznacz tylko dwie warstwy!")
    }else{
        alert("Zaznacz tylko dwie warstwy!")
    }
}

document.getElementById('ile').style.display = 'none';
document.getElementById('ile2').style.display = 'none';
document.querySelector('label[for="ile"]').style.display = 'none';
document.querySelector('label[for="ile2"]').style.display = 'none';
function splitGPXHandler() {
    const wyborDiv = document.querySelector('.choose');
    const wyborForm = wyborDiv.querySelector('form');
        if (wyborDiv.style.display === 'none' || wyborDiv.style.display === '') {
            wyborDiv.style.display = 'block';
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
        } else {
            wyborDiv.style.display = 'none';
        }
}
document.querySelector('.choose').style.display = 'none';
function splitGPX() {
    const layersList = document.getElementById('layersList');
    if (selectedSegments.length === 0) {
        alert("Brak zaznaczonych segmentów do podziału!");
        return;
    }
    if (selectedSegments.length > 1) {
        alert("Zaznacz tylko jedną warstwę do podziału!");
        return;
    }
    const { layer: layerToSplit, modifiedId } = selectedSegments[0];
    const index = layers.findIndex(layer =>
        layer._leaflet_id === layerToSplit._leaflet_id || layer._leaflet_id === modifiedId
    );
    if (index === -1) {
        alert("Nie można znaleźć zaznaczonej warstwy w `layers`.");
        return;
    }
    const coordinatesToSplit = layersCoordinates[index];
    if (!coordinatesToSplit || coordinatesToSplit.length === 0) {
        alert("Wybrana warstwa nie zawiera danych do podziału.");
        return;
    }
    map.removeLayer(layerToSplit);
    layers.splice(index, 1);
    layersCoordinates.splice(index, 1);
    const selectedOption = document.querySelector('input[name="wybor"]:checked')?.value;
    if (!selectedOption) {
        alert("Proszę wybrać jedną z opcji podziału.");
        return;
    }
    let segmentsToAdd;
    if (selectedOption === 'opcja1') {
        const parts = parseInt(document.getElementById('ile').value);
        if (isNaN(parts) || parts <= 0) {
            alert("Proszę podać poprawną liczbę części.");
            return;
        }
        segmentsToAdd = splitGPXByParts(coordinatesToSplit, parts);
    } else if (selectedOption === 'opcja2') {
        const segmentLengthKm = parseFloat(document.getElementById('ile2').value);
        if (isNaN(segmentLengthKm) || segmentLengthKm <= 0) {
            alert("Proszę podać poprawną długość odcinka.");
            return;
        }
        segmentsToAdd = splitLineByKilometer(coordinatesToSplit, segmentLengthKm); 
    }
    if (!segmentsToAdd || segmentsToAdd.length === 0) {
        alert("Nie udało się podzielić warstwy na segmenty.");
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
        segments.push(trackSegmentLayer);
        layers.push(trackSegmentLayer);
        layersCoordinates.push(coordinates);
        layerSelection(trackSegmentLayer);
    });
    manageLayersControl();
    selectedSegments = [];
}
document.getElementById('divide').addEventListener('click', (e) => {
    splitGPX();
});
function clearMap() {
    const layersList = document.getElementById('layersList');
    if (selectedSegments.length > 0) {
        selectedSegments.forEach(({ modifiedId }) => {
            console.log("Sprawdzanie zaznaczonego modifiedId:", modifiedId);
            const layerIndex = layers.findIndex(layer => layer._leaflet_id === modifiedId);
            if (layerIndex !== -1) {
                console.log(`Usuwanie warstwy z layers, indeks: ${layerIndex}, _leaflet_id: ${layers[layerIndex]._leaflet_id}`);
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
    if (trackLayer) {
        map.removeLayer(trackLayer);
        trackLayer = null;
    }
    if (layers.length > 0) {
        layers.forEach(layer => {
            if (layer) {
                map.removeLayer(layer);
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
function updateStatsForLayer(coordinates) {
    let pointCount = coordinates.length;
    let totalLength = 0;
    let elevationGain = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
        let start = L.latLng(coordinates[i][1], coordinates[i][0]);
        let end = L.latLng(coordinates[i + 1][1], coordinates[i + 1][0]);
        totalLength += start.distanceTo(end) / 1000;
        let elevationDiff = coordinates[i + 1][2] - coordinates[i][2];
        if (elevationDiff > 0) {
            elevationGain += elevationDiff;
        }
    }
    return {
        pointCount: pointCount,
        totalLength: totalLength,
        elevationGain: elevationGain
    };
}
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
    document.querySelector('#sform').style.display = 'none';
});
function downloadGPXHandler() {
    const saveForm = document.querySelector('#sform');

    if (saveForm.style.display === 'none' || saveForm.style.display === '') {
        saveForm.style.display = 'block';
    } else {
        saveForm.style.display = 'none';
    }
}
function createElevationChart(distances, elevations) {
    const ctx = document.getElementById('elevationChart').getContext('2d');
    if (elevationChart !== null) {
        elevationChart.destroy();
    }
    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [{
                label: 'Przewyższenia (m)',
                data: elevations,
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
let CustomControl = L.Control.extend({
    options: {
        position: 'topright' 
    },
    onAdd: function(map) {
        let container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');

        let splitButton = L.DomUtil.create('a', '', container);
        splitButton.href = '#';
        splitButton.text = 'D'
        splitButton.style.background = 'white';

        let mergeButton = L.DomUtil.create('a', '', container);
        mergeButton.href = '#';
        mergeButton.text = 'M'
        mergeButton.style.background = 'white';

        let statsButton = L.DomUtil.create('a', '', container);
        statsButton.href = '#';
        statsButton.text = 'S'
        statsButton.style.background = 'white';

        let clearButton = L.DomUtil.create('a', '', container);
        clearButton.href = '#';
        clearButton.text = 'C'
        clearButton.style.background = 'white';

        let downloadButton = L.DomUtil.create('a', '', container);
        downloadButton.href = '#';
        downloadButton.text = '↓'
        downloadButton.style.background = 'white';

        let fillButton = L.DomUtil.create('a', '', container);
        fillButton.href = '#';
        fillButton.text = 'F';
        fillButton.style.background = 'white';

        L.DomEvent.on(splitButton, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            splitGPXHandler();
        });

        L.DomEvent.on(statsButton, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            statsHandler();
        });

        L.DomEvent.on(clearButton, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            clearMap();
        });

        L.DomEvent.on(mergeButton, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            mergeGPX();
        });
        L.DomEvent.on(downloadButton, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            downloadGPXHandler();
        });
        L.DomEvent.on(fillButton, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            fillGap();
        });
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
    if (!layersList) {
        console.error("Nie znaleziono elementu layersList.");
        return;
    }
    layersList.innerHTML = '';
    layers.forEach((layer, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = layer.fileName || `Warstwa ${index + 1}`;
        listItem.dataset.layerId = layer._leaflet_id;
        listItem.style.cursor = 'pointer';
        listItem.addEventListener('click', () => {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
                listItem.style.textDecoration = 'line-through';
            } else {
                map.addLayer(layer);
                listItem.style.textDecoration = 'none';
            }
        });
        layersList.appendChild(listItem);
    });
}
function statsHandler() {
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
                    const layerStats = updateStatsForLayer(coordinates);
                    stats.pointCount += layerStats.pointCount;
                    stats.totalLength += parseFloat(layerStats.totalLength);
                    stats.elevationGain += layerStats.elevationGain;
                    let totalDistance = distances.length > 0 ? distances[distances.length - 1] : 0;
                    for (let i = 1; i < coordinates.length; i++) {
                        let start = L.latLng(coordinates[i - 1][1], coordinates[i - 1][0]);
                        let end = L.latLng(coordinates[i][1], coordinates[i][0]);
                        let distance = start.distanceTo(end) / 1000;
                        totalDistance += distance;
                        distances.push(totalDistance);
                        elevations.push(coordinates[i][2]);
                    }
                }
            });
            tableBody.innerHTML = '';
            const row = document.createElement('tr');
            const cellCount = document.createElement('td');
            const cellLength = document.createElement('td');
            const cellElevation = document.createElement('td');
            cellCount.textContent = stats.pointCount;
            cellLength.textContent = stats.totalLength.toFixed(2);
            cellElevation.textContent = stats.elevationGain;
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

