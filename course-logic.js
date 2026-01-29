// 1. SETUP
const urlParams = new URLSearchParams(window.location.search);
const courseId = urlParams.get('id') || "default"; 
const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjtsbIOgM43Hj89GWHkC8QYS1ujZKvS_S3m89em5RHWPhSXnxbT1bopKlaKsU0mdcoYVXZrnl_0OLs/pub?output=csv' + '&cache=' + Math.random();

// 2. INIT MAPLIBRE
const map = new maplibregl.Map({
    container: 'course-map',
    preserveDrawingBuffer: true,
    style: {
        'version': 8,
        'sources': {
            'raster-tiles': {
                'type': 'raster',
                'tiles': ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
                'tileSize': 256,
                'attribution': '&copy; OpenStreetMap contributors &copy; CARTO'
            }
        },
        'layers': [{
            'id': 'simple-tiles',
            'type': 'raster',
            'source': 'raster-tiles',
            'minzoom': 0, 'maxzoom': 22
        }]
    },
    center: [-8, 53], zoom: 7
});

map.addControl(new maplibregl.NavigationControl());

// 3. FETCH SHEET DATA
Papa.parse(sheetUrl, {
    download: true, header: true, skipEmptyLines: true,
    complete: function(results) {
        const row = results.data.find(r => {
            const name = r.name || r.Event || r.Name; 
            if(!name) return false;
            return name.toLowerCase().replace(/parkrun/gi, '').replace(/,/g, '').trim().replace(/\s+/g, '') === courseId;
        });

        if(row) {
            const name = row.name || row.Event || row.Name;
            const ascVal = row.ascent || row.Ascent || "0";
            const descVal = row.descent || row.Descent || "0";
            const timeVal = row.time || row.Time || "9:30 AM";
            const type = row.route_type || row.Type || "Course";
            const terrain = row.profile || row.Profile || row.Terrain;
            const websiteVal = row.website || row.Website;
            
            document.title = name + " | Profile";
            document.getElementById('course-title').innerText = name;
            document.getElementById('ascent-val').innerText = ascVal + 'm';
            document.getElementById('descent-val').innerText = descVal + 'm';
            document.getElementById('time-val').innerText = timeVal;

            // Update Website Link
            const websiteLink = document.getElementById('course-website');
            if (websiteVal && websiteVal.trim() !== "") {
                websiteLink.href = websiteVal;
                websiteLink.style.display = 'inline-flex';
            }

            const asc = parseInt(ascVal) || 0;
            let css = "very-flat", cat = "Very Flat";
            if (asc > 10) { css = "flat"; cat = "Flat"; }
            if (asc > 20) { css = "undulating"; cat = "Undulating"; }
            if (asc > 40) { css = "hilly"; cat = "Hilly"; }
            if (asc > 60) { css = "very-hilly"; cat = "Very Hilly"; }

            const badgeContainer = document.getElementById('course-badges');
            badgeContainer.innerHTML = `
                <span class="category-badge ${css}">${cat}</span>
                <span class="stat-badge">${type}</span>
                ${terrain ? `<span class="stat-badge">${terrain}</span>` : ''}
            `;

            loadGPX(courseId, asc);
        } else {
            document.getElementById('course-title').innerText = "Course Not Found";
        }
    }
});

// 4. LOAD GPX & RENDER CHART
function loadGPX(id, sheetAscent) {
    fetch(`./gpx/${id}.gpx`)
        .then(response => {
            if(!response.ok) throw new Error("GPX file not found");
            return response.text();
        })
        .then(str => {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(str, "text/xml");
            const trkpts = xmlDoc.querySelectorAll("trkpt");
            
            const coordinates = [];
            const elevations = [];
            const distances = [];
            let distAcc = 0;

            for(let i=0; i<trkpts.length; i++) {
                const lat = parseFloat(trkpts[i].getAttribute("lat"));
                const lon = parseFloat(trkpts[i].getAttribute("lon"));
                const ele = parseFloat(trkpts[i].querySelector("ele")?.textContent || 0);

                coordinates.push([lon, lat]);
                elevations.push(ele);

                if(i > 0) {
                    const prev = coordinates[i-1];
                    distAcc += getDistanceFromLatLonInKm(prev[1], prev[0], lat, lon);
                }
                distances.push(distAcc); 
            }

            const totalActualDist = distances[distances.length - 1];
            const stretchedDistances = distances.map(d => (d / totalActualDist) * 5);

            const drawRoute = () => {
                if(map.getSource('route')) return;
                map.addSource('route', {
                    'type': 'geojson',
                    'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': coordinates } }
                });
                map.addLayer({
                    'id': 'route', 'type': 'line', 'source': 'route',
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#3b82f6', 'line-width': 4 }
                });
                const bounds = coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
                map.fitBounds(bounds, { padding: 40 });

                new maplibregl.Marker({color: '#10b981'}).setLngLat(coordinates[0]).addTo(map);
                new maplibregl.Marker({color: '#ef4444'}).setLngLat(coordinates[coordinates.length-1]).addTo(map);
            };

            if (map.loaded()) drawRoute(); else map.on('load', drawRoute);
            renderEChart(stretchedDistances, elevations, sheetAscent, coordinates, distances);
        })
        .catch(e => console.error(e));
}

function renderEChart(stretchedDistances, elevations, ascent, coordinates, actualDistances) {
    const chartDom = document.getElementById('elevationChart');
    const myChart = echarts.init(chartDom);
    
    const minEle = Math.min(...elevations);
    const maxEle = Math.max(...elevations);
    const range = maxEle - minEle;
    let yMin = 'dataMin', yMax = 'dataMax';

    if (range < 30) {
        const center = (maxEle + minEle) / 2;
        yMin = Math.floor(center - 15);
        yMax = Math.ceil(center + 15);
        if (yMin < 0) yMin = 0; 
    }

    const dataPairs = stretchedDistances.map((d, i) => [d, elevations[i]]);
    const isFlat = ascent < 10;
    let hoverMarker = null;

    const option = {
        tooltip: { 
            trigger: 'axis', 
            formatter: function(params) {
                const index = params[0].dataIndex;
                const pt = params[0];
                const coord = coordinates[index];

                if (coord) {
                    if (!hoverMarker) {
                        const el = document.createElement('div');
                        el.className = 'chart-tracker';
                        hoverMarker = new maplibregl.Marker({ element: el }).setLngLat(coord).addTo(map);
                    } else {
                        hoverMarker.setLngLat(coord).getElement().style.display = 'block';
                    }
                }
                const dist = actualDistances[index].toFixed(2);
                const ele = Math.round(pt.value[1]);
                return `${dist} km<br><b>${ele} m</b>`;
            }
        },
        // 'containLabel: true' is what was pushing your chart. 
        // By rounding the axis labels below, we fix the issue.
        grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
        
        xAxis: { type: 'value', min: 0, max: 5, interval: 1, axisLabel: { formatter: '{value}k' }, splitLine: { show: false } },
        
        yAxis: { 
            type: 'value', 
            scale: true, 
            min: yMin, 
            max: yMax,
            // FIX: Force labels to be integers to prevent 28.0000000034 stretching the grid
            axisLabel: {
                formatter: function (value) {
                    return Math.round(value);
                }
            }
        },
        
        series: [{
            name: 'Elevation', type: 'line', data: dataPairs, symbol: 'none',
            smooth: isFlat ? 0.6 : 0.1, 
            areaStyle: { opacity: 0.1, color: '#3b82f6' },
            lineStyle: { color: '#3b82f6', width: 2 }
        }]
    };
    
    myChart.setOption(option);
    myChart.resize(); // Keeps the resize fix from before

    myChart.getZr().on('globalout', () => {
        if(hoverMarker) hoverMarker.getElement().style.display = 'none';
    });
    window.addEventListener('resize', myChart.resize);
}

function getDistanceFromLatLonInKm(lat1,lon1,lat2,lon2) {
  var R = 6371; 
  var dLat = (lat2-lat1) * (Math.PI/180);  
  var dLon = (lon2-lon1) * (Math.PI/180); 
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*(Math.PI/180)) * Math.cos(lat2*(Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
}

// 5. EXPORT & NATIVE SHARE IMAGE FUNCTION
async function exportCourseImage() {
    const btn = document.getElementById('share-btn');
    const websiteLink = document.getElementById('course-website');
    const backLink = document.querySelector('.back-link');
    const originalContent = btn.innerHTML;
    
    btn.innerHTML = "Processing...";
    btn.disabled = true;
    
    backLink.style.display = 'none';
    websiteLink.style.display = 'none'; 
    btn.style.display = 'none';
    
    const element = document.getElementById('capture-area');
    const courseName = document.getElementById('course-title').innerText;

    // --- WATERMARK: TOP RIGHT ---
    const watermark = document.createElement('div');
    watermark.innerText = "saturday5k.ie";
    watermark.style.position = "absolute";
    watermark.style.top = "30px";  
    watermark.style.right = "30px";
    watermark.style.fontSize = "14px";
    watermark.style.fontWeight = "800";
    watermark.style.color = "#94a3b8";
    watermark.style.fontFamily = "'Inter', sans-serif";
    watermark.style.zIndex = "999";
    
    const originalPos = element.style.position;
    element.style.position = 'relative';
    element.appendChild(watermark);

    try {
        const canvas = await html2canvas(element, {
            useCORS: true,
            scale: 2,
            backgroundColor: "#ffffff"
        });

        watermark.remove();
        element.style.position = originalPos;
        btn.innerHTML = originalContent;
        btn.disabled = false;
        btn.style.display = 'flex';
        backLink.style.display = 'inline-block';
        if (websiteLink.getAttribute('href') !== '#') websiteLink.style.display = 'inline-flex';

        canvas.toBlob(async (blob) => {
            const file = new File([blob], `${courseId}_profile.png`, { type: 'image/png' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: `${courseName} Profile`,
                        text: `Check out the course profile for ${courseName} on saturday5k.ie!`
                    });
                } catch (shareErr) {
                    console.log("User cancelled or failed share", shareErr);
                }
            } else {
                const link = document.createElement('a');
                link.download = `${courseName}_profile.png`;
                link.href = URL.createObjectURL(blob);
                link.click();
            }
        }, 'image/png');

    } catch (err) {
        console.error("Export failed:", err);
        alert("Could not generate image.");
        if(watermark) watermark.remove();
        element.style.position = originalPos;
        btn.innerHTML = originalContent;
        btn.disabled = false;
        btn.style.display = 'flex';
        backLink.style.display = 'inline-block';
        if (websiteLink.getAttribute('href') !== '#') websiteLink.style.display = 'inline-flex';
    }
}