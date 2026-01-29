// --- CONFIGURATION ---
const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjtsbIOgM43Hj89GWHkC8QYS1ujZKvS_S3m89em5RHWPhSXnxbT1bopKlaKsU0mdcoYVXZrnl_0OLs/pub?output=csv' + '&cache=' + Math.random();

// 1. Initialize MapLibre
// 1. Initialize MapLibre
const irelandBounds = [
    [-11.0, 51.2], // Southwest coordinates (approx Mizen Head)
    [-5.0, 55.6]   // Northeast coordinates (approx Malin Head)
];

const map = new maplibregl.Map({
    container: 'map',
    style: {
        'version': 8,
        'sources': {
            'raster-tiles': {
                'type': 'raster',
                'tiles': ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
                'tileSize': 256,
                'attribution': '&copy; OpenStreetMap &copy; CARTO'
            }
        },
        'layers': [{ 'id': 'simple-tiles', 'type': 'raster', 'source': 'raster-tiles', 'minzoom': 0, 'maxzoom': 22 }]
    },
    // REPLACE center/zoom WITH THIS:
    bounds: irelandBounds, 
    fitBoundsOptions: { padding: 20 },
    
    cooperativeGestures: true // Keeps your "Two finger move" setting
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-left');

// Global state
let globalData = [];
let colMap = {};
let popup = new maplibregl.Popup({ offset: [0, -35], closeButton: false });

// 2. Generate Pin Images & Load Data
map.on('load', () => {
    // A. Generate the 5 colored pin images for the map to use
    const colors = {
        'Very Flat': '#eab308',
        'Flat': '#10b981',
        'Undulating': '#3b82f6',
        'Hilly': '#f59e0b',
        'Very Hilly': '#ef4444'
    };

    const loadPin = (name, color) => {
        const svg = `
        <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 0C6.71573 0 0 6.71573 0 15C0 26.25 15 42 15 42C15 42 30 26.25 30 15C30 6.71573 23.2843 0 15 0Z" fill="${color}"/>
            <circle cx="15" cy="15" r="5" fill="white"/>
        </svg>`;
        const img = new Image(30, 42);
        img.onload = () => map.addImage(`pin-${name}`, img);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    };

    Object.entries(colors).forEach(([name, color]) => loadPin(name, color));

    // B. Setup the Data Source
    map.addSource('courses', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } // Start empty
    });

    // C. Add the Layer to render pins
    map.addLayer({
        'id': 'course-pins',
        'type': 'symbol',
        'source': 'courses',
        'layout': {
            'icon-image': ['get', 'iconName'], // Use the icon name calculated in data
            'icon-size': 1,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true
        }
    });

    // D. Fetch CSV Data
    Papa.parse(sheetUrl, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) {
            if (!results.data.length) return;
            const headers = Object.keys(results.data[0]);
            
            colMap = {
                name: headers.find(h => h.match(/name|event/i)),
                lat:  headers.find(h => h.match(/lat/i) && !h.match(/location/i)),
                lon:  headers.find(h => h.match(/lon/i) && !h.match(/location/i)),
                ascent: headers.find(h => h.match(/ascent|gain/i)),
                county: headers.find(h => h.match(/county|region/i)),
                type: headers.find(h => h.match(/route_type|type/i)),
                terrain: headers.find(h => h.match(/profile|terrain/i)),
                time: headers.find(h => h.match(/time/i))
            };
            
            globalData = results.data.filter(row => row[colMap.name] && !isNaN(parseFloat(row[colMap.lat])));
            
            populateLocationFilter(globalData);
            populateRouteFilter(globalData); 
            populateTerrainFilter(globalData);
            
            // Initial Render
            handleControls();
        }
    });

    // E. Interaction (Clicks & Hover)
    map.on('click', 'course-pins', (e) => {
        const props = e.features[0].properties;
        const coordinates = e.features[0].geometry.coordinates.slice();
        
        // Ensure popup appears over the point even if zoomed out
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        const color = props.color;
        const html = `<b>${props.name}</b><br><a href="course.html?id=${props.id}" class="popup-btn" style="color:${color}">VIEW PROFILE</a>`;

        popup.setLngLat(coordinates).setHTML(html).addTo(map);
    });

    // Change cursor on hover
    map.on('mouseenter', 'course-pins', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'course-pins', () => map.getCanvas().style.cursor = '');
});

// 3. Filtering & Rendering Logic
function handleControls() {
    // 1. Gather Filter Values
    const searchVal = document.getElementById('searchInput').value.toLowerCase();
    const locFilters = Array.from(document.querySelectorAll('#location-dropdown input:checked')).map(cb => cb.value);
    const gradeVal = document.getElementById('gradeFilter').value;
    const typeVal = document.getElementById('routeTypeFilter').value;
    const terrainVal = document.getElementById('terrainFilter').value;
    const sortVal = document.getElementById('sortOrder').value;

    // 2. Filter Data
    let filtered = globalData.filter(item => {
        const name = item[colMap.name].toLowerCase();
        const county = item[colMap.county];
        const asc = parseInt(item[colMap.ascent]) || 0;
        
        const matchesSearch = name.includes(searchVal);
        const matchesLoc = locFilters.length === 0 || locFilters.includes(county);
        
        let gradeMatch = true;
        if(gradeVal === "Very Flat") gradeMatch = asc <= 10;
        else if(gradeVal === "Flat") gradeMatch = asc > 10 && asc <= 20;
        else if(gradeVal === "Undulating") gradeMatch = asc > 20 && asc <= 40;
        else if(gradeVal === "Hilly") gradeMatch = asc > 40 && asc <= 60;
        else if(gradeVal === "Very Hilly") gradeMatch = asc > 60;

        const matchesType = typeVal === "All" || item[colMap.type] === typeVal;
        const matchesTerrain = terrainVal === "All" || item[colMap.terrain] === terrainVal;

        return matchesSearch && matchesLoc && gradeMatch && matchesType && matchesTerrain;
    });

    // 3. Sort Data
    if (sortVal === 'flat') filtered.sort((a, b) => (parseInt(a[colMap.ascent])||0) - (parseInt(b[colMap.ascent])||0));
    else if (sortVal === 'hilly') filtered.sort((a, b) => (parseInt(b[colMap.ascent])||0) - (parseInt(a[colMap.ascent])||0));

    // 4. Update Map Source (The Efficient Part!)
    const geojson = {
        type: 'FeatureCollection',
        features: filtered.map(item => {
            const asc = parseInt(item[colMap.ascent]) || 0;
            let cat = "Very Flat";
            if (asc > 10) cat = "Flat";
            if (asc > 20) cat = "Undulating";
            if (asc > 40) cat = "Hilly";
            if (asc > 60) cat = "Very Hilly";

            // Determine Icon Color for Popup Link
            const colors = { 'Very Flat': '#eab308', 'Flat': '#10b981', 'Undulating': '#3b82f6', 'Hilly': '#f59e0b', 'Very Hilly': '#ef4444' };
            
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [parseFloat(item[colMap.lon]), parseFloat(item[colMap.lat])]
                },
                properties: {
                    name: item[colMap.name],
                    id: item[colMap.name].toLowerCase().replace(/parkrun/gi, '').replace(/,/g, '').trim().replace(/\s+/g, ''),
                    iconName: `pin-${cat}`, // Points to the image we generated
                    color: colors[cat]
                }
            };
        })
    };

    if(map.getSource('courses')) {
        map.getSource('courses').setData(geojson);
    }

    // 5. Update Sidebar List
    renderSidebar(filtered);
}

// 4. Render Sidebar (DOM Only)
function renderSidebar(data) {
    const sidebar = document.getElementById('location-list');
    sidebar.innerHTML = '';

    data.forEach(item => {
        const name = item[colMap.name];
        const lat = parseFloat(item[colMap.lat]);
        const lng = parseFloat(item[colMap.lon]);
        const courseId = name.toLowerCase().replace(/parkrun/gi, '').replace(/,/g, '').trim().replace(/\s+/g, '');
        const asc = parseInt(item[colMap.ascent]) || 0;
        
        let css = "very-flat", cat = "Very Flat";
        if (asc > 10) { css = "flat"; cat = "Flat"; }
        if (asc > 20) { css = "undulating"; cat = "Undulating"; }
        if (asc > 40) { css = "hilly"; cat = "Hilly"; }
        if (asc > 60) { css = "very-hilly"; cat = "Very Hilly"; }

        const div = document.createElement('div');
        div.className = 'location-item';
        div.onclick = () => {
            // Fly to location
            map.flyTo({ center: [lng, lat], zoom: 13 });
            
            // Trigger Popup programmatically
            const colors = { 'Very Flat': '#eab308', 'Flat': '#10b981', 'Undulating': '#3b82f6', 'Hilly': '#f59e0b', 'Very Hilly': '#ef4444' };
            const html = `<b>${name}</b><br><a href="course.html?id=${courseId}" class="popup-btn" style="color:${colors[cat]}">VIEW PROFILE</a>`;
            popup.setLngLat([lng, lat]).setHTML(html).addTo(map);

            // Highlight sidebar item
            document.querySelectorAll('.location-item').forEach(d => d.classList.remove('active'));
            div.classList.add('active');
            
            // On mobile, if sidebar is hidden, this logic handles the zoom, but user sees map.
        };

        div.innerHTML = `
            <div class="sidebar-content-top">
                <h3 class="sidebar-title">${name}</h3>
                <div class="sidebar-meta">${item[colMap.county] || ''} • ${item[colMap.time] || '9:30 AM'}</div>
                <div class="badge-container small-badges">
                    <span class="category-badge ${css}">${cat}</span>
                    <span class="stat-badge">${item[colMap.type] || 'Course'}</span>
                    ${item[colMap.terrain] ? `<span class="stat-badge">${item[colMap.terrain]}</span>` : ''} 
                    <span class="stat-badge">▲ ${asc}m</span>
                </div>
            </div>
            <div class="sidebar-image-full">
                 <img src="./charts/${courseId}_card_elevation.png" onerror="this.style.display='none'">
            </div>
        `;
        sidebar.appendChild(div);
    });
}

// 5. Filter Helpers (Populate Dropdowns)
function populateLocationFilter(data) {
    const list = document.getElementById('location-items');
    const dropdown = document.getElementById('location-dropdown');
    dropdown.querySelector('.anchor').onclick = () => dropdown.classList.toggle('visible');
    
    const provMapping = {
        "Leinster": ["Dublin", "Kildare", "Meath", "Wicklow", "Wexford", "Louth", "Kilkenny", "Carlow", "Laois", "Offaly", "Westmeath", "Longford"],
        "Munster": ["Cork", "Kerry", "Limerick", "Tipperary", "Clare", "Waterford"],
        "Connacht": ["Galway", "Mayo", "Sligo", "Roscommon", "Leitrim"],
        "Ulster": ["Donegal", "Cavan", "Monaghan"]
    };
    
    const provs = { "Leinster": [], "Munster": [], "Connacht": [], "Ulster": [] };
    data.forEach(item => {
        const c = item[colMap.county];
        if(!c) return;
        for (const [p, arr] of Object.entries(provMapping)) {
            if (arr.includes(c) && !provs[p].includes(c)) provs[p].push(c);
        }
    });

    list.innerHTML = '';
    for (const [p, arr] of Object.entries(provs)) {
        if(arr.length) {
            list.innerHTML += `<li class="province-header">${p}</li>`;
            arr.sort().forEach(c => {
                list.innerHTML += `<li><label><input type="checkbox" value="${c}" onchange="handleControls()"/> ${c}</label></li>`;
            });
        }
    }
}

function populateRouteFilter(data) {
    const s = document.getElementById('routeTypeFilter');
    const types = new Set(data.map(i => i[colMap.type]).filter(x=>x));
    Array.from(types).sort().forEach(t => s.innerHTML += `<option value="${t}">${t}</option>`);
}

function populateTerrainFilter(data) {
    const s = document.getElementById('terrainFilter');
    const types = new Set(data.map(i => i[colMap.terrain]).filter(x=>x));
    Array.from(types).sort().forEach(t => s.innerHTML += `<option value="${t}">${t}</option>`);
}

function resetFilters() {
    // 1. Reset Text Input
    document.getElementById('searchInput').value = '';

    // 2. Reset Dropdowns
    document.getElementById('gradeFilter').value = 'All';
    document.getElementById('routeTypeFilter').value = 'All';
    document.getElementById('terrainFilter').value = 'All';
    document.getElementById('sortOrder').value = 'default';

    // 3. Uncheck all location boxes
    document.querySelectorAll('#location-dropdown input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });

    // 4. Refresh Map
    handleControls();
}

// --- MOBILE FILTER TOGGLE ---
function toggleFilters() {
    const filters = document.querySelector('.filter-bar');
    const btn = document.getElementById('mobile-filter-toggle');
    
    // Toggle the class that shows the filters
    filters.classList.toggle('open');
    
    // Change Button Text
    if (filters.classList.contains('open')) {
        btn.innerHTML = 'Hide Filters ▴';
    } else {
        btn.innerHTML = 'Show Filters ▾';
    }
}