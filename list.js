const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjtsbIOgM43Hj89GWHkC8QYS1ujZKvS_S3m89em5RHWPhSXnxbT1bopKlaKsU0mdcoYVXZrnl_0OLs/pub?output=csv' + '&cache=' + Math.random();  

let globalData = [];
let colMap = {};
const container = document.getElementById('full-list-container');

// Display loading state
container.innerHTML = '<div style="padding:40px; text-align:center; color:#64748b;">Loading race cards...</div>';

Papa.parse(sheetUrl, {
    download: true, header: true, skipEmptyLines: true,
    complete: function(results) {
        if (!results.data || results.data.length === 0) {
            container.innerHTML = 'No data found.';
            return;
        }

        const headers = Object.keys(results.data[0]);
        colMap = {
            name: headers.find(h => h.match(/name|event/i)),
            ascent: headers.find(h => h.match(/ascent|gain/i)),
            county: headers.find(h => h.match(/county|region/i)),
            type: headers.find(h => h.match(/route_type|type/i)),
            terrain: headers.find(h => h.match(/profile|terrain/i)),
            time: headers.find(h => h.match(/time/i))
        };

        globalData = results.data.filter(row => row[colMap.name]);
        
        populateLocationFilter(globalData);
        populateRouteFilter(globalData);
        populateTerrainFilter(globalData);
        renderList(globalData);
    }
});

function renderList(data) {
    container.innerHTML = '';
    if(data.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center;">No races match filters.</div>';
        return;
    }

    data.forEach(item => {
        const name = item[colMap.name];
        const asc = parseInt(item[colMap.ascent]) || 0;
        
        let css = "very-flat", cat = "Very Flat";
        if (asc > 10) { css = "flat"; cat = "Flat"; }
        if (asc > 20) { css = "undulating"; cat = "Undulating"; }
        if (asc > 40) { css = "hilly"; cat = "Hilly"; }
        if (asc > 60) { css = "very-hilly"; cat = "Very Hilly"; }

        const rType = item[colMap.type] || "Course";
        const terrain = item[colMap.terrain];
        const courseId = name.toLowerCase().replace(/parkrun/gi, '').replace(/,/g, '').trim().replace(/\s+/g, '');

        const row = document.createElement('div'); 
        row.className = 'list-row'; 
        row.onclick = () => window.location.href = `course.html?id=${courseId}`;
        
        row.innerHTML = `
            <div class="row-info">
                <div class="badge-container" style="margin-bottom:8px;">
                    <span class="category-badge ${css}">${cat}</span>
                    <span class="stat-badge">${rType}</span>
                    ${terrain ? `<span class="stat-badge">${terrain}</span>` : ''} 
                    <span class="stat-badge">▲ ${asc}m</span>
                </div>
                <h3 style="margin:0; font-size:18px;">${name}</h3>
                <div style="color:var(--gray); font-size:14px; margin-top:4px;">
                    ${item[colMap.county] || ''} • ${item[colMap.time] || '9:30 AM'}
                </div>
            </div>
            <div class="row-chart">
                <img src="./charts/${courseId}_card_elevation.png" onerror="this.style.display='none'" alt="Profile">
            </div>
        `;
        container.appendChild(row);
    });
}

window.handleListControls = function() {
    const searchVal = document.getElementById('searchInput').value.toLowerCase();
    const locFilters = Array.from(document.querySelectorAll('#location-dropdown input:checked')).map(cb => cb.value);
    const gradeVal = document.getElementById('gradeFilter').value;
    const typeVal = document.getElementById('routeTypeFilter').value;
    const terrainVal = document.getElementById('terrainFilter').value;
    const sortVal = document.getElementById('sortOrder').value;

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

    if (sortVal === 'flat') filtered.sort((a, b) => (parseInt(a[colMap.ascent])||0) - (parseInt(b[colMap.ascent])||0));
    else if (sortVal === 'hilly') filtered.sort((a, b) => (parseInt(b[colMap.ascent])||0) - (parseInt(a[colMap.ascent])||0));

    renderList(filtered);
};

function populateLocationFilter(data) {
    const list = document.getElementById('location-items');
    const dropdown = document.getElementById('location-dropdown');
    dropdown.querySelector('.anchor').onclick = () => dropdown.classList.toggle('visible');
    
    const provs = { "Leinster": [], "Munster": [], "Connacht": [], "Ulster": [] };
    const provMapping = {
        "Leinster": ["Dublin", "Kildare", "Meath", "Wicklow", "Wexford", "Louth", "Kilkenny", "Carlow", "Laois", "Offaly", "Westmeath", "Longford"],
        "Munster": ["Cork", "Kerry", "Limerick", "Tipperary", "Clare", "Waterford"],
        "Connacht": ["Galway", "Mayo", "Sligo", "Roscommon", "Leitrim"],
        "Ulster": ["Donegal", "Cavan", "Monaghan"]
    };
    
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
                list.innerHTML += `<li><label><input type="checkbox" value="${c}" onchange="handleListControls()"/> ${c}</label></li>`;
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

function resetListFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('gradeFilter').value = 'All';
    document.getElementById('routeTypeFilter').value = 'All';
    document.getElementById('terrainFilter').value = 'All';
    document.getElementById('sortOrder').value = 'default';
    document.querySelectorAll('#location-dropdown input[type="checkbox"]').forEach(cb => cb.checked = false);
    handleListControls();
}

// --- MINIMIZE HEADER LOGIC ---
const header = document.querySelector('.main-header');
const filterBtn = document.getElementById('scroll-filter-btn');

document.addEventListener('scroll', function(e) {
    // 1. Identify which element is scrolling (Window vs Body)
    const target = e.target.scrollingElement || e.target || document.documentElement;
    const scrollTop = target.scrollTop || 0;

    // 2. Logic: If at top -> Show all. If scrolled -> Minimize.
    if (scrollTop < 10) {
        header.classList.remove('header-scrolled');
        header.classList.remove('filters-expanded');
        if(filterBtn) filterBtn.innerHTML = 'Show Filters <span style="font-size:10px">▼</span>';
    } else {
        header.classList.add('header-scrolled');
    }
}, true); // Use 'true' to capture scroll events on specific elements like body

function toggleScrollFilters() {
    header.classList.toggle('filters-expanded');
    if (header.classList.contains('filters-expanded')) {
        filterBtn.innerHTML = 'Hide Filters <span style="font-size:10px">▲</span>';
    } else {
        filterBtn.innerHTML = 'Show Filters <span style="font-size:10px">▼</span>';
    }
}