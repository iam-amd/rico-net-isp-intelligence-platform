import os
import sys
import subprocess

# 1. Ensure fpdf2 is installed
try:
    import fpdf
except ImportError:
    print("Installing fpdf2 library for PDF generation...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fpdf2", "--quiet"])
    from fpdf import FPDF

from fpdf import FPDF

class ChecklistPDF(FPDF):
    def header(self):
        # Arial bold
        self.set_font('Helvetica', 'B', 15)
        # Title
        self.cell(0, 10, 'Rico Net - Pandur OLT Field Installation Guide', 0, 1, 'C')
        # Line break
        self.ln(5)
        self.set_draw_color(0, 82, 204) # Blue divider line
        self.set_line_width(0.8)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(5)

    def footer(self):
        # Position at 1.5 cm from bottom
        self.set_y(-15)
        # Arial italic 8
        self.set_font('Helvetica', 'I', 8)
        # Page number
        self.cell(0, 10, f'Page {self.page_no()} | Rico Net ISP Platform Config', 0, 0, 'C')

def create_pdf(filename="Pandur_OLT_Setup_Checklist.pdf"):
    pdf = ChecklistPDF()
    pdf.alias_nb_pages()
    pdf.add_page()
    
    # Section: Pre-setup Information
    pdf.set_font('Helvetica', 'B', 12)
    pdf.set_text_color(0, 82, 204)
    pdf.cell(0, 10, '1. Pre-deployment Node Details', 0, 1, 'L')
    pdf.set_text_color(0, 0, 0)
    pdf.set_font('Helvetica', '', 10)
    
    # Metadata table
    pdf.cell(50, 7, 'Target Device:', 1, 0, 'L')
    pdf.cell(140, 7, 'Raspberry Pi 2 (Collector)', 1, 1, 'L')
    pdf.cell(50, 7, 'Tailscale IP:', 1, 0, 'L')
    pdf.cell(140, 7, '100.93.120.87 (Auto-Reconnecting)', 1, 1, 'L')
    pdf.cell(50, 7, 'Backend Server IP:', 1, 0, 'L')
    pdf.cell(140, 7, '100.x.x.x (Pings configured in Watchdog)', 1, 1, 'L')
    pdf.cell(50, 7, 'WiFi Hotspot SSID:', 1, 0, 'L')
    pdf.cell(140, 7, 'Bagrudeen Ali\'s iPhone (Saved Profile)', 1, 1, 'L')
    pdf.cell(50, 7, 'Hotspot Password:', 1, 0, 'L')
    pdf.cell(140, 7, 'amd12345', 1, 1, 'L')
    pdf.ln(5)
    
    # Section: Step-by-Step Checklist
    pdf.set_font('Helvetica', 'B', 12)
    pdf.set_text_color(0, 82, 204)
    pdf.cell(0, 10, '2. On-Site Steps at Pandur OLT', 0, 1, 'L')
    pdf.set_text_color(0, 0, 0)
    
    steps = [
        ("Step 1: Phone Hotspot Activation", 
         "Open settings on your iPhone -> Personal Hotspot. Turn Maximize Compatibility ON. Leave this screen open and active on your phone screen while booting the Pi."),
        ("Step 2: Power up the Pi", 
         "Plug the Pi's USB power adapter into a UPS backup power socket on-site (crucial so that it survives power cuts and registers power alarms)."),
        ("Step 3: Laptop connection", 
         "Connect your laptop to your iPhone's hotspot. Open your terminal or Command Prompt on the laptop and log in using SSH:\n  ssh rico@100.93.120.87  (Password: replace-with-private-password)"),
        ("Step 4: Configure Pandur Site WiFi", 
         "Type: sudo raspi-config\nGo to: System Options -> Wireless LAN.\nEnter the actual Pandur OLT site WiFi SSID (name) and Password.\nTurn off your iPhone's hotspot. The Pi will connect to the site WiFi automatically within 60s."),
        ("Step 5: Physical OLT Connection", 
         "Connect the Ethernet patch cable from the Pi's Ethernet port directly to the EMS / Management Port of the Pandur OLT."),
        ("Step 6: Verify Communication", 
         "Log back into the Pi (over site WiFi or Tailscale) and test connection to the OLT:\n  ping 10.10.10.100  (or the actual Pandur OLT IP).")
    ]
    
    for title, desc in steps:
        pdf.set_font('Helvetica', 'B', 10)
        # Checkbox symbol
        pdf.rect(10, pdf.get_y() + 1.5, 4, 4)
        pdf.set_x(17)
        pdf.cell(0, 7, title, 0, 1, 'L')
        
        pdf.set_font('Helvetica', '', 9.5)
        pdf.set_x(17)
        pdf.multi_cell(0, 5, desc)
        pdf.ln(3)

    # Section: Important Notes
    pdf.ln(2)
    pdf.set_font('Helvetica', 'B', 11)
    pdf.set_text_color(204, 0, 0) # Red for warnings
    pdf.cell(0, 7, 'Important Notes / Troubleshooting:', 0, 1, 'L')
    pdf.set_text_color(0, 0, 0)
    pdf.set_font('Helvetica', 'I', 9)
    
    notes = (
        "- Disabling Key Expiry: Remember to open tailscale.com, find 'riconet-olt-2' in Machines, "
        "and select 'Disable Key Expiry' so you never get logged out after 6 months.\n"
        "- Auto-Healing Watchdog: The Pi has a watchdog script running every 5 minutes. If it loses internet "
        "or Tailscale connection, it will automatically restart the services and reboot itself if needed. "
        "Do not manually power cycle unless absolutely necessary.\n"
        "- Ethernet Static Config: The collector host's Ethernet port is pre-configured to communicate with the "
        "private OLT management subnet. Ensure the OLT management port is on this subnet."
    )
    pdf.multi_cell(0, 5, notes)
    
    # Save the file
    pdf.output(filename)
    print(f"PDF generated successfully as '{filename}'!")

if __name__ == "__main__":
    create_pdf()
