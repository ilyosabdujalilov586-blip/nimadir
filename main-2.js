async function askGemini(userMessage) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', text: userMessage }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server ${response.status}`);
    return data.text;

  } catch (error) {
    console.error("Tarmoq yoki kod xatoligi:", error);
    throw error;
  }
}