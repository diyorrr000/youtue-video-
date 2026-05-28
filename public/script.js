const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const processBtn = document.getElementById('process-btn');
const statusSection = document.getElementById('status-section');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');
const resultsSection = document.getElementById('results-section');
const clipsGrid = document.getElementById('clips-grid');
const statusText = document.getElementById('status-text');

let selectedFile = null;

// Drag and drop handlers
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

function handleFiles(files) {
    if (files.length > 0) {
        selectedFile = files[0];
        fileName.textContent = `Selected: ${selectedFile.name} (${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)`;
        fileInfo.style.display = 'block';
    }
}

processBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    // Reset UI
    processBtn.disabled = true;
    statusSection.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    resultsSection.style.display = 'none';
    clipsGrid.innerHTML = '';
    statusText.textContent = 'Uploading video...';

    const formData = new FormData();
    formData.append('video', selectedFile);

    try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        // Upload progress
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = `${percent}%`;
                progressPercent.textContent = `Uploading: ${percent}%`;

                if (percent === 100) {
                    statusText.textContent = 'Magic in progress... Clips will appear as they finish! ✨';
                }
            }
        };

        xhr.onload = function () {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                startStatusListening(response.jobId);
            } else {
                alert('An error occurred during upload.');
                resetUI();
            }
        };

        xhr.onerror = function () {
            alert('Upload failed.');
            resetUI();
        };

        xhr.send(formData);

    } catch (error) {
        console.error('Error:', error);
        alert('Something went wrong.');
        resetUI();
    }
});

function startStatusListening(jobId) {
    resultsSection.style.display = 'block';
    const eventSource = new EventSource(`/status/${jobId}`);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'clip') {
            appendClip(data.clip);
        } else if (data.type === 'done') {
            statusText.textContent = 'All clips are ready! 🎉';
            progressBar.style.width = '100%';
            progressPercent.textContent = 'Done!';
            eventSource.close();
            processBtn.disabled = false;
        }
    };

    eventSource.onerror = (err) => {
        console.error('SSE Error:', err);
        eventSource.close();
        processBtn.disabled = false;
    };
}

function appendClip(clip) {
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.innerHTML = `
        <video controls>
            <source src="${clip.url}" type="video/mp4">
            Your browser does not support the video tag.
        </video>
        <div class="clip-info">
            <h3>${clip.name}</h3>
            <a href="${clip.url}" download="${clip.name}.mp4" class="download-link">
                <i class="fas fa-download"></i> Download
            </a>
        </div>
    `;
    clipsGrid.appendChild(card);

    // Auto scroll to latest clip
    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function resetUI() {
    processBtn.disabled = false;
    statusSection.style.display = 'none';
}
