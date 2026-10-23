const visibilityItems = [...document.querySelectorAll('[data-visibility]')];

window.blocksMenu.onInit(visibility => {
  for (const checkbox of visibilityItems) {
    const name = checkbox.dataset.visibility;
    checkbox.checked = visibility[name] !== false;
  }
});

for (const checkbox of visibilityItems) {
  checkbox.addEventListener('change', () => {
    window.blocksMenu.setVisibility(checkbox.dataset.visibility, checkbox.checked);
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.blocksMenu.close();
});
