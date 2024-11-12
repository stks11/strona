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

let drawnSegments = [];
let selectedSegments = [];
let trackLayer = null;
let coordinates = [];
let elevationChart = null;
let segments = [];


document.getElementById('fileInput').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const gpxText = e.target.result;
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(gpxText, 'text/xml');
            let trackPoints = Array.from(xmlDoc.querySelectorAll('trkpt'));
            
            coordinates = trackPoints.map(point => {
                return [parseFloat(point.getAttribute('lon')), parseFloat(point.getAttribute('lat')), parseFloat(point.getElementsByTagName('ele')[0].textContent)];
            });

            let trackJSON = {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates
                }
            };
            if (trackLayer) {
                map.removeLayer(trackLayer);
            }
            trackLayer = L.geoJSON(trackJSON).addTo(map);
            map.fitBounds(trackLayer.getBounds());
        };
        reader.readAsText(file);
    }
});


function splitGPX(coordinates, parts) {
    let totalPoints = coordinates.length;
    let segmentSize = Math.floor(totalPoints / parts);
    
    for (let i = 0; i < parts; i++) {
        if (i === parts - 1) {
            segments.push(coordinates.slice(i * segmentSize));
        } else {
            segments.push(coordinates.slice(i * segmentSize, ((i + 1) * segmentSize + 1)));
        }
    }
    return segments;
}


function splitLineByKilometer(coordinates, segmentLengthKm) {
    let line = turf.lineString(coordinates);
    
    let totalLength = turf.length(line, { units: 'kilometers' });
    let currentDistance = 0;

    while (currentDistance < totalLength) {
        let start = currentDistance;
        let end = Math.min(currentDistance + segmentLengthKm, totalLength);
        let segment = turf.lineSliceAlong(line, start, end, { units: 'kilometers' });
        
        segments.push(segment.geometry.coordinates);

        currentDistance = end;
    }

    return segments;
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

function mergeGPX(){
    if (!segments || segments.length === 0) {
        alert("Brak segmentów do połączenia.");
        return;
    }

    const lineStrings = segments.map(segment => turf.lineString(segment));
    
    const mergedFeatureCollection = turf.featureCollection(lineStrings);
    const mergedLine = turf.combine(mergedFeatureCollection);
    
    drawnSegments.forEach(segment => map.removeLayer(segment));
    drawnSegments = [];
    
    const trackSegmentLayer = L.geoJSON(mergedLine, {
        style: { color: 'blue', weight: 4 }
    }).addTo(map);
    
    drawnSegments.push(trackSegmentLayer);

    map.fitBounds(trackSegmentLayer.getBounds());
}


document.getElementById('divide').addEventListener('click', (e) => {
    const wyborDiv = document.querySelector('.choose');
    const wyborForm = wyborDiv.querySelector('form');
    const selectedOption = wyborForm.querySelector('input[name="wybor"]:checked');

    if (!selectedOption) {
        alert("Proszę wybrać jedną z opcji podziału.");
        return;
    }

    if (coordinates.length > 0) {
        let segments;

        if (selectedOption.value === 'opcja1') {
            let parts = parseInt(document.getElementById('ile').value);
            if (isNaN(parts) || parts <= 0) {
                alert("Proszę podać poprawną liczbę części.");
                return;
            }
            
            segments = splitGPX(coordinates, parts);
           
        } else if (selectedOption.value === 'opcja2') {
            let segmentLengthKm = parseFloat(document.getElementById('ile2').value);
            if (isNaN(segmentLengthKm) || segmentLengthKm <= 0) {
                alert("Proszę podać poprawną długość odcinka.");
                return;
            }
            segments = splitLineByKilometer(coordinates, segmentLengthKm);
        }

        drawnSegments.forEach(segment => map.removeLayer(segment));
        drawnSegments = [];

        segments.forEach((segment, index) => {
            let trackJSON = {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": segment
                }
            };
            let colors = ['red', 'green', 'orange', 'purple', 'yellow'];
            let color = colors[index % colors.length];

            let trackSegmentLayer = L.geoJSON(trackJSON, {
                style: { color: color, weight: 3 },
                onEachFeature: function (feature, layer) {
                    layer.on('click', function () {
                        if (selectedSegments.includes(layer)) {
                            layer.setStyle({ color: color });
                            selectedSegments = selectedSegments.filter(l => l !== layer);
                        } else {
                            layer.setStyle({ color: 'blue', weight: 5 });
                            selectedSegments.push(layer);
                        }
                    });
                }
            }).addTo(map);

            drawnSegments.push(trackSegmentLayer);
        });

        wyborDiv.style.display = 'none';
        wyborForm.reset();
        document.getElementById('ile').style.display = 'none';
        document.getElementById('ile2').style.display = 'none';
        document.querySelector('label[for="ile"]').style.display = 'none';
        document.querySelector('label[for="ile2"]').style.display = 'none';

        map.fitBounds(trackLayer.getBounds());
    } else {
        alert("Nie załadowano pliku GPX");
    }
});


function clearMap() {
    if (trackLayer) {
        map.removeLayer(trackLayer);
        trackLayer = null;
    }

    if (drawnSegments.length > 0) {
        drawnSegments.forEach(segment => map.removeLayer(segment));
        drawnSegments = [];
    }

    selectedSegments = [];

    const tableBody = document.getElementById('statsTable').querySelector('tbody');
    tableBody.innerHTML = '';
    document.getElementById('statsTable').style.display = 'none';

    const fileInputElement = document.getElementById('fileInput');
    if (fileInputElement) {
        fileInputElement.value = '';
    }
}



function updateStats() {
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
        totalLength: totalLength.toFixed(2), 
        elevationGain: elevationGain
    };
}

document.getElementById('save').addEventListener('click', (e) => {
    let gpxData = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpsies="https://www.gpsies.com/GPX/1/0" version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
        xsi:schemaLocation="http://www.topografix.com/GPX/1/1">
        <metadata>
        <name>${new Date().toDateString()}</name>
        </metadata>
        <trk>
        <trkseg>
        `;    

    const selectedOption = document.querySelector('input[name="select"]:checked');
    let dataToSave;
    
    let convertedSegments = [];

    selectedSegments.forEach(segment => {
        const coordinates = segment.getLatLngs();
        coordinates.forEach(coord => {
            convertedSegments.push([coord.lng, coord.lat, coord.alt]);
        });
    });

    if(selectedOption){
            dataToSave = convertedSegments;
        }else{
            dataToSave = coordinates;
        }
    
    dataToSave.forEach(cords => {
        let [lon, lat, ele] = cords;
        gpxData += `<trkpt lon="${lon}" lat="${lat}">\n<ele>${ele}</ele>\n</trkpt>\n`;
    });
    gpxData += `</trkseg>
        </trk>
        </gpx>`

    if ((!segments || segments.length === 0) || !trackLayer) {
        alert("Brak danych do pobrania");
    } else {
        const blob = new Blob([gpxData], { type: 'application/gpx+xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);

        let nazwaPliku = document.getElementById('stext').value
        if(nazwaPliku){
            link.download = `${nazwaPliku}`+ '.gpx';
        }else{
            link.download = 'Trasa.gpx'
        }
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    document.querySelector('#sform').style.display = 'none';
    selectedOption.checked = false;;
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

        return container;

    }
});

map.addControl(new CustomControl());

function statsHandler() {
    const statsTable = document.getElementById('statsTable');
    const tableBody = statsTable.querySelector('tbody');

    if (statsTable.style.display === 'table') {
        statsTable.style.display = 'none';
        document.getElementById('elevationChart').style.display = 'none';
    } else {
        if (coordinates.length > 0) {
            let stats = updateStats();

            tableBody.innerHTML = '';

            const row = document.createElement('tr');
            const cellCount = document.createElement('td');
            const cellLength = document.createElement('td');
            const cellElevation = document.createElement('td');

            cellCount.textContent = stats.pointCount;
            cellLength.textContent = stats.totalLength;
            cellElevation.textContent = stats.elevationGain;

            row.appendChild(cellCount);
            row.appendChild(cellLength);
            row.appendChild(cellElevation);
            tableBody.appendChild(row);

            statsTable.style.display = 'table';

            let distances = [0];
            let elevations = [coordinates[0][2]];

            let totalDistance = 0;

            for (let i = 1; i < coordinates.length; i++) {
                let start = L.latLng(coordinates[i-1][1], coordinates[i-1][0]);
                let end = L.latLng(coordinates[i][1], coordinates[i][0]);
                let distance = start.distanceTo(end) / 1000;
                totalDistance += distance;
                distances.push(totalDistance);
                elevations.push(coordinates[i][2]);
            }
           
            createElevationChart(distances, elevations);

            document.getElementById('elevationChart').style.display = 'block';
        } else {
            alert("Nie załadowano pliku GPX lub brak punktów.");
        }
    }
};
