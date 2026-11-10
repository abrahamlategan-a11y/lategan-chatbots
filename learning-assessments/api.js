const assessmentApi = {
  escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
  },
  async post(role, code, action, data = {}) {
    const response = await fetch("https://lategan-chatbot.abrahamlategan.workers.dev", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({...data, action: "lh_assessment_" + role + "_" + action, [role + "_code"]: code})
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      throw Object.assign(new Error(result.error || "The assessment service is unavailable."), {status: response.status});
    }
    return result;
  }
};
