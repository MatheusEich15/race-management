document.addEventListener('DOMContentLoaded', () => {
    // Function to convert a single select element into segmented control buttons
    function convertSelectToSegmented(select) {
        if (select.dataset.converted) return;
        select.dataset.converted = "true";
        select.style.display = 'none';

        // Create container wrapper
        const container = document.createElement('div');
        container.className = 'select-container-custom';

        // Create label
        const label = document.createElement('div');
        label.className = 'select-label-custom';
        
        // Formulate a beautiful label text
        let labelText = select.id.replace('solo-', '').replace('local-', '').replace('lobby-', '');
        if (labelText === 'bots') labelText = 'Bots';
        if (labelText === 'diff') labelText = 'Difficulty';
        if (labelText === 'track') labelText = 'Track';
        // Capitalize first letter
        labelText = labelText.charAt(0).toUpperCase() + labelText.slice(1);
        label.textContent = labelText + ':';
        container.appendChild(label);

        // Create button group
        const group = document.createElement('div');
        group.className = 'selector-group';
        container.appendChild(group);

        // Helper function to build options
        function buildOptions() {
            group.innerHTML = '';
            Array.from(select.options).forEach(opt => {
                // Skip placeholder options (empty value)
                if (opt.value === "" && opt.disabled) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'selector-option';
                btn.textContent = opt.textContent;
                btn.dataset.value = opt.value;

                if (select.value === opt.value) {
                    btn.classList.add('active');
                }

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (select.value !== opt.value) {
                        select.value = opt.value;
                        select.dispatchEvent(new Event('change'));
                    }
                    
                    // Update active class on buttons
                    group.querySelectorAll('.selector-option').forEach(b => {
                        b.classList.toggle('active', b.dataset.value === opt.value);
                    });
                });

                group.appendChild(btn);
            });
        }

        buildOptions();

        // Observe select options for changes (useful for dynamically populated dropdowns like #lobby-track)
        const observer = new MutationObserver(() => {
            buildOptions();
        });
        observer.observe(select, { childList: true });

        // Intercept JS property updates on .value so programmatical updates sync back to buttons
        const originalValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        Object.defineProperty(select, 'value', {
            get() {
                return originalValueDescriptor.get.call(this);
            },
            set(val) {
                originalValueDescriptor.set.call(this, val);
                group.querySelectorAll('.selector-option').forEach(b => {
                    b.classList.toggle('active', b.dataset.value == val);
                });
            }
        });

        // Insert container in place of the parent row if it exists, or right before the select
        const parentRow = select.closest('.setup-row');
        if (parentRow) {
            parentRow.parentNode.insertBefore(container, parentRow);
            parentRow.style.display = 'none'; // hide the original setup-row completely
        } else {
            select.parentNode.insertBefore(container, select);
        }
    }

    // Convert all selects present on the page
    document.querySelectorAll('select').forEach(select => {
        convertSelectToSegmented(select);
    });

    // Also watch for new selects added dynamically to the DOM
    const bodyObserver = new MutationObserver((mutations) => {
        mutations.forEach(mut => {
            mut.addedNodes.forEach(node => {
                if (node.tagName === 'SELECT') {
                    convertSelectToSegmented(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('select').forEach(s => convertSelectToSegmented(s));
                }
            });
        });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
});
