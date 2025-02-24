const uploadForm = document.getElementById("uploadForm");
const scriptLinkContainer = document.getElementById("scriptLinkContainer");
const askButton = document.getElementById("askButton");
let dynamicScriptId = null;

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(uploadForm);
  const clientName = document.getElementById("clientName").value;
  formData.append("clientName", clientName);
  try {
    const response = await fetch("http://localhost:8080/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    dynamicScriptId = data.scriptId;

    // Display the script link
    scriptLinkContainer.innerHTML = `
      <p>Embed this script:</p>
      <pre>&lt;script src="http://localhost:8080/ask/${dynamicScriptId}";"&gt;&lt;/script&gt;</pre>
    `;

    askButton.style.display = "block";
  } catch (error) {
    console.error("File upload error:", error);
    alert("Error uploading file.");
  }
});

// Ask Me Anything Button
askButton.addEventListener("click", () => {
  const greeting = new SpeechSynthesisUtterance("How can I help you?");
  window.speechSynthesis.speak(greeting);

  setTimeout(() => {
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = "en-US";

    recognition.onresult = async (event) => {
      const question = event.results[0][0].transcript;
      try {
        const response = await fetch(`http://localhost:8080/process-speech/${dynamicScriptId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });

        const data = await response.json();
        const answer = new SpeechSynthesisUtterance(data.answer);
        window.speechSynthesis.speak(answer);
      } catch (error) {
        console.error("Error processing speech:", error);
      }
    };

    recognition.onerror = (err) => {
      console.error("Speech recognition error:", err);
    };

    recognition.start();
  }, 1000);
});
async function loadFiles() {
  const response = await fetch("/files");
  const data = await response.json();
  const fileTable = document.querySelector("#fileTable tbody");
  fileTable.innerHTML = "";

  data.files.forEach((file) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${file}</td>
      <td>
        <button onclick="editFile('${file}')">Edit</button>
        <button onclick="deleteFile('${file}')">Delete</button>
      </td>
    `;

    fileTable.appendChild(row);
  });
}

// Delete file function
async function deleteFile(fileName) {
  if (confirm(`Are you sure you want to delete ${fileName}?`)) {
    const response = await fetch(`/delete/${fileName}`, { method: "DELETE" });
    const data = await response.json();
    alert(data.message);
    loadFiles();
  }
}
async function editFile(fileName) {
  const response = await fetch(`/download/${fileName}`);
  const blob = await response.blob();

  const reader = new FileReader();
  reader.onload = function (e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    const table = document.getElementById("editTable");
    table.innerHTML = "";

    // Create table headers
    const headerRow = document.createElement("tr");
    Object.keys(sheet[0]).forEach((key) => {
      const th = document.createElement("th");
      th.textContent = key;
      headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Create editable table rows
    sheet.forEach((row) => {
      const tr = document.createElement("tr");
      Object.values(row).forEach((value) => {
        const td = document.createElement("td");
        td.contentEditable = "true";
        td.textContent = value;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    document.getElementById("editor").style.display = "block";
    document.getElementById("editor").dataset.fileName = fileName;
  };

  reader.readAsArrayBuffer(blob);
}

// Save the edited file
async function saveEdit() {
  const fileName = document.getElementById("editor").dataset.fileName;
  const table = document.getElementById("editTable");

  const rows = table.querySelectorAll("tr");
  const keys = Array.from(rows[0].children).map((th) => th.textContent);

  const data = Array.from(rows).slice(1).map((row) => {
    let obj = {};
    row.querySelectorAll("td").forEach((td, i) => {
      obj[keys[i]] = td.textContent;
    });
    return obj;
  });

  const response = await fetch("/save-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, data }),
  });

  const result = await response.json();
  alert(result.message);
}

