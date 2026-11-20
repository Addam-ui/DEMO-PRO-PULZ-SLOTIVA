// Nastaví světlý/tmavý motiv ještě před vykreslením stránky (bez probliknutí).
try {
  var theme = localStorage.getItem('rs-theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
} catch (e) {
  /* localStorage nemusí být dostupný */
}
